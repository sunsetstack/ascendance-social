import { inject, injectable } from "tsyringe";
import {
  CommunityPublicId,
  asPostPublicId,
  asCommunityPublicId,
  asUserPublicId,
} from "@/types/branded";
import mongoose, { Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { CreatePostCommand } from "./createPost.command";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import type { AttachmentSummary, IPost, IUser, PostDTO } from "@/types";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { TagService } from "@/services/tag.service";
import { ImageService } from "@/services/image.service";
import { RedisService } from "@/services/redis.service";
import { DTOService } from "@/services/dto.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import {
  PostNotFoundError,
  UserNotFoundError,
  mapPostError,
} from "../../../errors/post.errors";
import { Errors } from "@/utils/errors";
import { sanitizeForMongo, sanitizeTextInput } from "@/utils/sanitizers";
import { generateSlug } from "@/utils/helpers";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { ImageUploadStrategySelector } from "@/services/image/upload";
import { PublicId } from "@/utils/value-objects";
import { TOKENS } from "@/types/tokens";

const MAX_BODY_LENGTH = 300;

interface TransactionResult {
  post: IPost;
  user: IUser;
  tagNames: string[];
}

@injectable()
export class CreatePostCommandHandler implements ICommandHandler<
  CreatePostCommand,
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
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.Community)
    private readonly communityRepository: CommunityRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.Tag) private readonly tagService: TagService,
    @inject(TOKENS.Services.Image) private readonly imageService: ImageService,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreatePostCommand): Promise<PostDTO> {
    // Validate publicId format via value object - throws ValidationError early
    try {
      PublicId.of(command.userPublicId);
    } catch {
      throw Errors.validation("Invalid userPublicId format", {
        context: { field: "userPublicId", value: command.userPublicId },
      });
    }

    let uploadResult: { url: string; publicId: string } | null = null;
    let transactionCommitted = false;

    try {
      // ── Phase 1: pre-commit work ──────────────────────────────────────────
      const user = await this.validateUser(command.userPublicId);

      let communityInternalId: Types.ObjectId | null = null;
      if (command.communityPublicId) {
        try {
          PublicId.of(command.communityPublicId);
        } catch {
          throw Errors.validation("Invalid communityPublicId format", {
            context: {
              field: "communityPublicId",
              value: command.communityPublicId,
            },
          });
        }
        const { communityId } = await this.validateCommunityMembership(
          asCommunityPublicId(command.communityPublicId),
          user._id as Types.ObjectId,
        );
        communityInternalId = communityId;
      }

      const strategy = ImageUploadStrategySelector.from(
        command,
        this.imageService,
      );
      if (strategy) {
        try {
          uploadResult = await strategy.upload(user.publicId);
        } catch (error) {
          throw mapPostError(error, {
            action: "upload-image",
            userPublicId: command.userPublicId,
            imageUploaded: false,
          });
        }
      }

      const txResult = await this.unitOfWork.executeInTransaction(async () =>
        this.runTransaction(command, user, communityInternalId, uploadResult),
      );

      // Commit boundary - errors after this line must NOT trigger compensation
      transactionCommitted = true;

      // ── Phase 2: post-commit (non-compensable) ────────────────────────────
      return await this.finalizePost(txResult);
    } catch (error) {
      // Only compensate if the transaction never committed
      if (!transactionCommitted && uploadResult) {
        await this.imageService
          .rollbackUpload(uploadResult.publicId)
          .catch((e) => {
            logger.error(
              "[CreatePostCommandHandler] Image rollback failed after transaction error",
              { error: e },
            );
          });
      }
      throw mapPostError(error, {
        action: "create-post",
        userPublicId: command.userPublicId,
        imageUploaded: Boolean(uploadResult),
      });
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async validateUser(publicId: string): Promise<IUser> {
    const user = await this.userReadRepository.findByPublicId(
      asUserPublicId(publicId),
    );
    if (!user) throw new UserNotFoundError();
    return user;
  }

  private async validateCommunityMembership(
    communityPublicId: CommunityPublicId,
    userId: Types.ObjectId,
  ): Promise<{ communityId: Types.ObjectId }> {
    const community =
      await this.communityRepository.findByPublicId(communityPublicId);
    if (!community) throw Errors.notFound("Community");

    const communityId = community._id as Types.ObjectId;
    const membership =
      await this.communityMemberRepository.findByCommunityAndUser(
        communityId,
        userId,
      );
    if (!membership)
      throw Errors.forbidden("You must be a member of the community to post");

    return { communityId };
  }

  private async runTransaction(
    command: CreatePostCommand,
    user: IUser,
    communityInternalId: Types.ObjectId | null,
    uploadResult: { url: string; publicId: string } | null,
  ): Promise<TransactionResult> {
    const internalUserId = user._id as mongoose.Types.ObjectId;
    const normalizedBody = this.normalizeBody(command.body);

    const tagNames = this.tagService.collectTagNames(
      normalizedBody,
      command.tags,
    );
    const tagDocs = await this.tagService.ensureTagsExist(tagNames);
    const tagIds = tagDocs.map((tag) => new mongoose.Types.ObjectId(tag._id));

    if (tagIds.length > 0) {
      await this.tagService.incrementUsage(tagIds);
    }

    const imageSummary = await this.createImageRecord(
      command,
      internalUserId,
      uploadResult,
    );

    const post = await this.buildPost(
      user,
      internalUserId,
      normalizedBody,
      tagIds,
      imageSummary,
      communityInternalId,
    );

    if (!communityInternalId) {
      await this.userWriteRepository.update(user.id, {
        $inc: { postCount: 1 },
      });
    } else {
      await this.communityRepository.findOneAndUpdate(
        { _id: communityInternalId },
        { $inc: { "stats.postCount": 1 } },
      );
    }

    await this.queueMentionNotifications(command, user, post, normalizedBody);

    const distinctTags = Array.from(new Set(tagNames));
    await this.eventBus.queueTransactional(
      new PostUploadedEvent(post.publicId, user.publicId, distinctTags),
    );

    return { post, user, tagNames };
  }

  private async createImageRecord(
    command: CreatePostCommand,
    internalUserId: mongoose.Types.ObjectId,
    uploadResult: { url: string; publicId: string } | null,
  ): Promise<AttachmentSummary> {
    if (!uploadResult) return { docId: null };

    const { summary } = await this.imageService.createImageRecord({
      url: uploadResult.url,
      storagePublicId: uploadResult.publicId,
      originalName: command.imageOriginalName || `post-${Date.now()}`,
      userInternalId: internalUserId.toString(),
    });

    if (!summary.docId)
      throw Errors.internal("Image document was not created", {
        context: { operation: "createImageRecord" },
      });
    return summary;
  }

  private async buildPost(
    user: IUser,
    internalUserId: mongoose.Types.ObjectId,
    normalizedBody: string,
    tagIds: mongoose.Types.ObjectId[],
    imageSummary: AttachmentSummary,
    communityId: Types.ObjectId | null,
  ): Promise<IPost> {
    const postSlug =
      imageSummary.slug ??
      `${generateSlug(normalizedBody, 60) || "post"}-${Date.now()}`;

    const payload: Partial<IPost> = {
      publicId: asPostPublicId(uuidv4()),
      user: internalUserId,
      author: {
        _id: internalUserId,
        publicId: user.publicId,
        handle: user.handle,
        username: user.username,
        avatarUrl: user.avatar ?? "",
        displayName: user.username,
      },
      body: normalizedBody,
      slug: postSlug,
      image: imageSummary.docId,
      tags: tagIds,
      likesCount: 0,
      commentsCount: 0,
      ...(communityId ? { communityId } : {}),
    };

    return this.postWriteRepository.create(
      sanitizeForMongo(payload) as unknown as IPost,
    );
  }

  private async queueMentionNotifications(
    command: CreatePostCommand,
    user: IUser,
    post: IPost,
    normalizedBody: string,
  ): Promise<void> {
    const mentionRegex = /@([a-zA-Z0-9._]+)/g;
    const mentions = [...normalizedBody.matchAll(mentionRegex)].map(
      (m) => m[1],
    );
    if (mentions.length === 0) return;

    const uniqueMentions = [...new Set(mentions)];
    const mentionedUsers =
      await this.userReadRepository.findUsersByHandles(uniqueMentions);

    for (const mentionedUser of mentionedUsers) {
      if (mentionedUser.publicId === user.publicId) continue;
      await this.eventBus.queueTransactional(
        new NotificationRequestedEvent({
          receiverId: mentionedUser.publicId,
          actionType: "mention",
          actorId: user.publicId,
          actorUsername: user.username,
          actorHandle: user.handle,
          actorAvatar: user.avatar,
          targetId: post.publicId,
          targetType: "post",
          targetPreview: command.body
            ? command.body.substring(0, 50) +
              (command.body.length > 50 ? "..." : "")
            : "",
        }),
      );
    }
  }

  private async finalizePost(result: TransactionResult): Promise<PostDTO> {
    const hydratedPost = await this.postReadRepository.findByPublicId(
      result.post.publicId,
    );
    if (!hydratedPost)
      throw new PostNotFoundError("Post not found after creation");

    await this.redisService.invalidateByTags([
      CacheKeyBuilder.getUserFeedTag(result.user.publicId),
    ]);

    return this.dtoService.toPostDTO(hydratedPost);
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
}
