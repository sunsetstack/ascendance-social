import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { RecordPostViewCommand } from "./recordPostView.command";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { PostViewRepository } from "@/repositories/postView.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { FeedService } from "@/services/feed/feed.service";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import { isValidPublicId } from "@/utils/sanitizers";
import {
  PostAuthorizationError,
  PostNotFoundError,
  UserNotFoundError,
  mapPostError,
} from "@/application/errors/post.errors";
import { logger } from "@/utils/winston";
import { IPost, IUser } from "@/types";
import {
  getPostViewBloomKey,
  POST_VIEW_BLOOM_OPTIONS,
  POST_VIEW_BLOOM_TTL_SECONDS,
} from "@/config/bloomConfig";

import { TOKENS } from "@/types/tokens";

@injectable()
export class RecordPostViewCommandHandler implements ICommandHandler<
  RecordPostViewCommand,
  boolean
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.PostView)
    private readonly postViewRepository: PostViewRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.Feed) private readonly feedService: FeedService,
    @inject(TOKENS.Services.TransactionQueue)
    private readonly transactionQueue: TransactionQueueService,
    @inject(TOKENS.Services.BloomFilter)
    private readonly bloomFilterService: BloomFilterService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {
    this.transactionQueue.registerHandler(
      "UPDATE_VIEW_COUNT_METADATA",
      async (payload: { postPublicId: string }) => {
        const updatedPost = await this.postReadRepository.findOneByPublicId(
          payload.postPublicId,
        );
        if (updatedPost?.viewsCount !== undefined) {
          await this.feedService.updatePostViewMeta(
            payload.postPublicId,
            updatedPost.viewsCount,
          );
        }
      },
    );
  }

  async execute(command: RecordPostViewCommand): Promise<boolean> {
    try {
      if (!isValidPublicId(command.postPublicId)) {
        throw Errors.validation("Invalid postPublicId format");
      }

      if (!isValidPublicId(command.userPublicId)) {
        throw Errors.validation("Invalid userPublicId format");
      }

      const post = await this.postReadRepository.findOneByPublicId(
        command.postPublicId,
      );

      if (!post) {
        throw new PostNotFoundError();
      }

      const postId = post._id as mongoose.Types.ObjectId;

      const user = await this.userReadRepository.findByPublicId(
        command.userPublicId,
      );

      if (!user) {
        throw new UserNotFoundError();
      }

      const userId = user._id as mongoose.Types.ObjectId;

      const isOwner =
        typeof (post as IPost).isOwnedBy === "function"
          ? (post as IPost).isOwnedBy(userId)
          : post.user.toString() === userId.toString();
      if (isOwner) {
        return false;
      }

      if (
        typeof (user as IUser).canViewPost === "function" &&
        !(user as IUser).canViewPost(post)
      ) {
        throw new PostAuthorizationError("User cannot view this post");
      }

      if (
        typeof (post as IPost).canBeViewedBy === "function" &&
        !(post as IPost).canBeViewedBy(user)
      ) {
        throw new PostAuthorizationError("User cannot view this post");
      }

      const bloomKey = getPostViewBloomKey();
      const bloomItem = `${command.postPublicId}:${command.userPublicId}`;

      const alreadyViewed = await this.wasLikelyAlreadyViewedByUser(
        bloomKey,
        bloomItem,
      );
      if (alreadyViewed) {
        // We accept a 1% false positive rate (i.e. 1% of legitimate first views might not be counted)
        // to drastically shield the DB from large influxes of view data, replacing millions of small Bloom Filters
        // or Sets with a single daily 1.19MB memory footprint.
        return false;
      }

      let isNewView = false;
      await this.unitOfWork.executeInTransaction(async () => {
        isNewView = await this.postViewRepository.recordView(postId, userId);

        if (isNewView) {
          await this.postWriteRepository.incrementViewCount(postId);
        }
      });

      await this.markViewSeenInBloom(bloomKey, bloomItem);

      if (isNewView) {
        // Queue redis and cache updates separately from DB transaction
        this.transactionQueue
          .executeOrQueue(
            "UPDATE_VIEW_COUNT_METADATA",
            { postPublicId: command.postPublicId },
            { priority: "low", loadThreshold: 30 },
          )
          .catch((err) => {
            logger.warn(
              "[RecordPostView] Failed to update view count metadata in feed (non-critical)",
              {
                postPublicId: command.postPublicId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          });
      }

      return isNewView;
    } catch (error) {
      throw mapPostError(error, {
        action: "record-post-view",
        postPublicId: command.postPublicId,
        userPublicId: command.userPublicId,
      });
    }
  }

  private async wasLikelyAlreadyViewedByUser(
    bloomKey: string,
    bloomItem: string,
  ): Promise<boolean> {
    try {
      return await this.bloomFilterService.mightContain(
        bloomKey,
        bloomItem,
        POST_VIEW_BLOOM_OPTIONS,
      );
    } catch (error) {
      logger.warn(
        "[Bloom][post-view] read failed; falling back to DB uniqueness check",
        {
          bloomKey,
          bloomItem,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }

  private async markViewSeenInBloom(
    bloomKey: string,
    bloomItem: string,
  ): Promise<void> {
    try {
      await this.bloomFilterService.add(
        bloomKey,
        bloomItem,
        POST_VIEW_BLOOM_OPTIONS,
        POST_VIEW_BLOOM_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn(
        "[Bloom][post-view] failed to seed bloom filter after view write",
        {
          bloomKey,
          bloomItem,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
