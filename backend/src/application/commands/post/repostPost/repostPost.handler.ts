import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RepostPostCommand } from "./repostPost.command";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { DTOService } from "@/services/dto.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import {
  isValidPublicId,
  sanitizeTextInput,
  sanitizeForMongo,
} from "@/utils/sanitizers";
import {
  IPost,
  IUser,
  PostDTO,
  PopulatedPostTag,
  PopulatedPostUser,
} from "@/types";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { TOKENS } from "@/types/tokens";

const MAX_BODY_LENGTH = 300;

@injectable()
export class RepostPostCommandHandler implements ICommandHandler<
  RepostPostCommand,
  PostDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: RepostPostCommand): Promise<PostDTO> {
    if (!isValidPublicId(command.userPublicId)) {
      throw Errors.validation("Invalid userPublicId format");
    }

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const targetPost = await this.postReadRepository.findByPublicId(
      command.targetPostPublicId,
    );
    if (!targetPost) {
      throw Errors.notFound("Post");
    }

    // prevent duplicate repost by same user
    const duplicates = await this.postReadRepository.countDocuments({
      user: (user as IUser)._id,
      repostOf: targetPost._id,
    });
    if (duplicates > 0) {
      throw Errors.validation("Post already reposted by this user");
    }

    const normalizedBody = this.normalizeBody(command.body);

    const created = (await this.unitOfWork.executeInTransaction(async () => {
      const postPublicId = uuidv4();
      const payload = sanitizeForMongo({
        publicId: postPublicId,
        user: user._id as mongoose.Types.ObjectId,
        author: {
          _id: user._id,
          publicId: user.publicId,
          handle: user.handle,
          username: user.username,
          avatarUrl: user.avatar ?? "",
          displayName: user.username,
        },
        body: normalizedBody,
        slug: `${postPublicId}`,
        type: "repost" as const,
        repostOf: targetPost._id,
        tags: Array.isArray(targetPost.tags)
          ? (
              targetPost.tags as (mongoose.Types.ObjectId | PopulatedPostTag)[]
            ).map((t) =>
              typeof t === "object" && "_id" in t
                ? (t as PopulatedPostTag)._id || t
                : t,
            )
          : [],
        likesCount: 0,
        commentsCount: 0,
        viewsCount: 0,
      }) as Partial<IPost>;

      const newPost = await this.postWriteRepository.create(payload);
      await this.postWriteRepository.updateRepostCount(
        targetPost._id!.toString(),
        1,
      );

      const targetOwner = this.resolvePostOwnerPublicId(targetPost);
      if (targetOwner && targetOwner !== command.userPublicId) {
        await this.eventBus.queueTransactional(
          new NotificationRequestedEvent({
            receiverId: targetOwner,
            actionType: "repost",
            actorId: command.userPublicId,
            actorUsername: user.username,
            actorHandle: user.handle,
            actorAvatar: user.avatar,
            targetId: targetPost.publicId,
            targetType: "post",
            targetPreview: this.buildPostPreview(targetPost),
          }),
        );
      }

      const tagNames = Array.isArray(targetPost.tags)
        ? (targetPost.tags as (mongoose.Types.ObjectId | PopulatedPostTag)[])
            .map((t) =>
              typeof t === "object" && "tag" in t
                ? (t as PopulatedPostTag).tag
                : undefined,
            )
            .filter((t): t is string => typeof t === "string")
        : [];

      await this.eventBus.queueTransactional(
        new PostUploadedEvent(
          newPost.publicId,
          user.publicId,
          Array.from(new Set(tagNames)),
        ),
      );

      return newPost;
    })) as IPost;

    const hydrated = await this.postReadRepository.findByPublicId(
      created.publicId,
    );
    if (!hydrated) {
      throw Errors.notFound("Resource");
    }

    return this.dtoService.toPostDTO(hydrated);
  }

  private normalizeBody(body?: string): string {
    if (!body) return "";
    try {
      return sanitizeTextInput(body, MAX_BODY_LENGTH);
    } catch (error) {
      if (error instanceof Error && error.message.includes("empty")) return "";
      if (error instanceof Error && error.message.includes("exceed")) {
        return sanitizeTextInput(
          body.slice(0, MAX_BODY_LENGTH),
          MAX_BODY_LENGTH,
        );
      }
      return "";
    }
  }

  private resolvePostOwnerPublicId(post: IPost): string {
    // Prefer author snapshot (always present in refined IPost)
    if (post.author?.publicId) {
      return post.author.publicId;
    }
    // Fallback to populated user if available (rare in lean + populates setup)
    const postUser = post.user as mongoose.Types.ObjectId | PopulatedPostUser;
    if (typeof postUser === "object" && "publicId" in postUser) {
      return (postUser as PopulatedPostUser).publicId ?? "";
    }
    return "";
  }

  private buildPostPreview(post: IPost): string {
    const body = post.body ?? "";
    if (body.length > 0) {
      return body.substring(0, 50) + (body.length > 50 ? "..." : "");
    }
    return post.image ? "[Image post]" : "[Post]";
  }
}
