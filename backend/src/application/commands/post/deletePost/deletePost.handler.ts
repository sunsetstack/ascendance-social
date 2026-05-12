import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { DeletePostCommand } from "./deletePost.command";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { CommentRepository } from "@/repositories/comment.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { TagService } from "@/services/tag.service";
import { ImageService } from "@/services/image.service";
import { RedisService } from "@/services/redis.service";
import { RetryPresets, RetryService } from "@/services/retry.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { IPost, IUser } from "@/types";
import {
  PostAuthorizationError,
  PostNotFoundError,
  UserNotFoundError,
  mapPostError,
} from "../../../errors/post.errors";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

export interface DeletePostResult {
  message: string;
}

@injectable()
export class DeletePostCommandHandler implements ICommandHandler<
  DeletePostCommand,
  DeletePostResult
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
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.Tag) private readonly tagService: TagService,
    @inject(TOKENS.Services.Image) private readonly imageService: ImageService,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Services.Retry) private readonly retryService: RetryService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: DeletePostCommand): Promise<DeletePostResult> {
    let postAuthorPublicId: string | undefined;
    let imageAssetToDelete: {
      url: string;
      ownerPublicId: string;
      requesterPublicId: string;
    } | null = null;

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const post = await this.validatePostExists(command.postPublicId);
        const user = await this.validateUserExists(command.requesterPublicId);

        const { postOwnerInternalId, postOwnerPublicId } =
          this.extractPostOwnerInfo(post);
        const postOwnerDoc = postOwnerInternalId
          ? await this.userReadRepository.findById(postOwnerInternalId)
          : null;

        postAuthorPublicId =
          postOwnerDoc?.publicId ??
          postOwnerPublicId ??
          command.requesterPublicId;

        await this.validateDeletePermission(user, post);

        const imageRemoval = await this.handleImageRecordDeletion(
          post,
          command.requesterPublicId,
          postOwnerDoc?.publicId ??
            postOwnerPublicId ??
            command.requesterPublicId,
        );

        if (imageRemoval?.removedUrl) {
          imageAssetToDelete = {
            url: imageRemoval.removedUrl,
            ownerPublicId: imageRemoval.ownerPublicId,
            requesterPublicId: command.requesterPublicId,
          };
        }

        await this.deletePostAndComments(post);
        if (postOwnerInternalId) {
          await this.userWriteRepository.update(postOwnerInternalId, {
            $inc: { postCount: -1 },
          });
        }

        await this.decrementTagUsage(post);
      });

      await this.deleteImageAssetAfterCommit(imageAssetToDelete);
      await this.invalidateCache(
        command.requesterPublicId,
        command.postPublicId,
      );
      await this.publishDeleteEvent(
        command.postPublicId,
        postAuthorPublicId ?? command.requesterPublicId,
      );

      return { message: "Post deleted successfully" };
    } catch (error) {
      throw mapPostError(error, {
        action: "delete-post",
        postPublicId: command.postPublicId,
        requesterPublicId: command.requesterPublicId,
        postAuthorPublicId,
      });
    }
  }

  private async validatePostExists(publicId: string): Promise<IPost> {
    const post = await this.postReadRepository.findByPublicId(publicId);
    if (!post) {
      throw new PostNotFoundError();
    }
    return post;
  }

  private async validateUserExists(publicId: string): Promise<IUser> {
    const user = await this.userReadRepository.findByPublicId(publicId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user;
  }

  private extractPostOwnerInfo(post: IPost): {
    postOwnerInternalId: string;
    postOwnerPublicId?: string;
  } {
    // In lean mode (findByPublicId), 'user' is an ObjectId and 'author' is the snapshot
    const userId = post.user as unknown as mongoose.Types.ObjectId;
    const authorSnapshot = post.author;

    const postOwnerInternalId = userId
      ? userId.toString()
      : (authorSnapshot?._id?.toString() ?? "");
    const postOwnerPublicId = authorSnapshot?.publicId;

    return { postOwnerInternalId, postOwnerPublicId };
  }

  private async validateDeletePermission(
    user: IUser,
    post: IPost,
  ): Promise<void> {
    const requesterId = user._id!.toString();
    // post.user is an ObjectId in lean mode
    const ownerId = (
      post.user as unknown as mongoose.Types.ObjectId
    ).toString();
    const isOwner = ownerId === requesterId;

    if (isOwner || user.isAdmin) {
      return;
    }

    if (post.communityId) {
      const member =
        await this.communityMemberRepository.findByCommunityAndUser(
          post.communityId,
          user._id as unknown as string,
        );
      if (member && (member.role === "admin" || member.role === "moderator")) {
        return;
      }
    }

    throw new PostAuthorizationError();
  }

  private async handleImageRecordDeletion(
    post: IPost,
    requesterPublicId: string,
    ownerPublicId: string,
  ): Promise<{ removedUrl: string; ownerPublicId: string } | null> {
    if (!post.image) {
      return null;
    }

    // Ensure we handle both populated object and direct ID (though findByPublicId populates it)
    const imageRef = post.image as unknown as
      | mongoose.Types.ObjectId
      | { _id: mongoose.Types.ObjectId };
    const imageId =
      imageRef instanceof mongoose.Types.ObjectId
        ? imageRef.toString()
        : imageRef._id.toString();

    if (!imageId) {
      console.warn(
        `[DeletePostHandler] Post ${post.publicId} has image reference but no valid imageId`,
      );
      return null;
    }

    try {
      const removal = await this.imageService.removePostAttachmentRecord({
        imageId,
      });

      if (removal.removed && removal.removedUrl) {
        return {
          removedUrl: removal.removedUrl,
          ownerPublicId: ownerPublicId || requesterPublicId,
        };
      }
    } catch (error) {
      console.error(
        `[DeletePostHandler] Failed to delete image ${imageId} for post ${post.publicId}:`,
        error,
      );
      return null;
    }

    return null;
  }

  private async deleteImageAssetAfterCommit(
    assetInfo: {
      url: string;
      ownerPublicId: string;
      requesterPublicId: string;
    } | null,
  ): Promise<void> {
    if (!assetInfo?.url) {
      return;
    }

    try {
      await this.retryService.execute(
        () =>
          this.imageService.deleteAttachmentAsset({
            requesterPublicId: assetInfo.requesterPublicId,
            ownerPublicId: assetInfo.ownerPublicId,
            url: assetInfo.url,
          }),
        RetryPresets.externalApi(),
      );
    } catch (error) {
      console.error(
        `[DeletePostHandler] Failed to delete image asset ${assetInfo.url}:`,
        error,
      );
    }
  }

  private async deletePostAndComments(post: IPost): Promise<void> {
    const postInternalId = post._id!.toString();
    await this.postWriteRepository.delete(postInternalId);
    await this.commentRepository.deleteCommentsByPostId(postInternalId);
  }

  private async decrementTagUsage(post: IPost): Promise<void> {
    if (!post.tags || post.tags.length === 0) {
      return;
    }

    // In lean mode (findByPublicId), tags are populated as plain objects
    const tagIds = (
      post.tags as (
        | mongoose.Types.ObjectId
        | { _id: mongoose.Types.ObjectId }
      )[]
    ).map((tag) => {
      const id = typeof tag === "object" && "_id" in tag ? tag._id : tag; // Handle both populated object and direct ID (fallback)
      return new mongoose.Types.ObjectId(id);
    });

    await this.tagService.decrementUsage(tagIds);
  }

  private async invalidateCache(
    userPublicId: string,
    postPublicId: string,
  ): Promise<void> {
    // 1. Remove from user's own feed cache
    await this.redisService.invalidateByTags([
      CacheKeyBuilder.getUserFeedTag(userPublicId),
    ]);

    // 2. Remove from global feed caches
    await this.redisService.invalidateByTags([
      CacheKeyBuilder.getTrendingFeedTag(),
      CacheKeyBuilder.getNewFeedTag(),
    ]);

    // 3. Remove from trending ZSET (leaderboard)
    await this.redisService.zrem("trending:posts", postPublicId);

    // 4. Remove from post metadata cache
    await this.redisService.invalidateByTags([
      CacheKeyBuilder.getPostMetaKey(postPublicId),
    ]);
  }

  private async publishDeleteEvent(
    postPublicId: string,
    authorPublicId: string,
  ): Promise<void> {
    await this.eventBus.publish(
      new PostDeletedEvent(postPublicId, authorPublicId),
    );
  }
}
