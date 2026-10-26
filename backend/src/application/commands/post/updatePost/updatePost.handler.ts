import { inject, injectable } from "tsyringe";
import type { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostUpdatedEvent } from "@/application/events/post/post.event";
import { UnitOfWork } from "@/database/UnitOfWork";
import type { IPostReadRepository, IPostWriteRepository, IUserReadRepository } from "@/repositories/interfaces";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { classifyContent, classifyRepostContent } from "@/services/feed/interests.policy";
import { asMongoId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { extractTagNames } from "@/utils/post-helpers";
import { sanitizedTextLength } from "@/utils/sanitizers";
import { UpdatePostCommand } from "./updatePost.command";

@injectable()
export class UpdatePostCommandHandler implements ICommandHandler<UpdatePostCommand, void> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork) private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead) private readonly posts: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite) private readonly writer: IPostWriteRepository,
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.FeedPreference) private readonly preferences: FeedPreferenceRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly events: EventBus,
  ) {}

  async execute(command: UpdatePostCommand): Promise<void> {
    if (sanitizedTextLength(command.body) > 600) throw Errors.validation("Post cannot exceed 600 characters");
    await this.unitOfWork.executeInTransaction(async () => {
      const user = await this.users.findByPublicId(command.requesterPublicId);
      if (!user) throw Errors.notFound("User");
      const post = await this.posts.findByPublicId(command.postPublicId);
      if (!post) throw Errors.notFound("Post");
      if (String(post.user) !== String(user._id)) throw Errors.forbidden("You can only edit your own posts");
      const tags = extractTagNames(post.tags);
      const body = command.body.trim();
      if (!body && post.type !== "repost" && (!post.image || !tags.length)) {
        throw Errors.validation("Add text or a description for this post");
      }
      let contentFeatures = classifyContent(body, tags, Boolean(post.image));
      if (post.type === "repost") {
        const reference = post.repostOf as unknown as { _id?: unknown } | null;
        if (!reference) throw Errors.notFound("Original post");
        const original = await this.posts.findById(asMongoId(String(reference._id ?? reference)));
        if (!original) throw Errors.notFound("Original post");
        const originalFeatures = original.contentFeatures ?? classifyContent(original.body ?? "", extractTagNames(original.tags), Boolean(original.image));
        contentFeatures = classifyRepostContent(body, Boolean(post.image), originalFeatures);
        await this.preferences.setSignal(String(user._id), String(original._id), "repost", originalFeatures, !body && !post.image);
      }
      const updated = await this.writer.update(asMongoId(String(post._id)), { body, contentFeatures, editedAt: new Date() });
      if (!updated) throw Errors.notFound("Post");
      await this.events.queueTransactional(new PostUpdatedEvent(command.postPublicId, command.requesterPublicId));
    });
  }
}
