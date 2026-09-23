import { mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import type {
  AccountCommunityCleanupParticipant,
  AccountContentCleanupParticipant,
  AccountConversationCleanupParticipant,
  AccountLifecycleUser,
  AccountOutboxParticipant,
  AccountPurgeOptions,
  AccountPurgeResult,
  AccountRecordCleanupParticipant,
  AccountSocialCleanupParticipant,
} from "./account-lifecycle.ports";
import { appendCleanup } from "./account-lifecycle.ports";
import type { ContentCleanupResult } from "./content-cleanup.service";

export type { AccountPurgeOptions, AccountPurgeResult } from "./account-lifecycle.ports";

type ObjectId = mongo.ObjectId;
const ObjectId = mongo.ObjectId;

@injectable()
export class AccountLifecycleService {
  constructor(
    @inject(TOKENS.Services.AccountContentCleanup)
    private readonly contentCleanupParticipant: AccountContentCleanupParticipant,
    @inject(TOKENS.Services.AccountSocialCleanup)
    private readonly socialCleanupParticipant: AccountSocialCleanupParticipant,
    @inject(TOKENS.Services.AccountConversationCleanup)
    private readonly conversationCleanupParticipant: AccountConversationCleanupParticipant,
    @inject(TOKENS.Services.AccountCommunityCleanup)
    private readonly communityCleanupParticipant: AccountCommunityCleanupParticipant,
    @inject(TOKENS.Services.AccountRecordCleanup)
    private readonly recordCleanupParticipant: AccountRecordCleanupParticipant,
    @inject(TOKENS.Services.AccountOutbox)
    private readonly outboxParticipant: AccountOutboxParticipant,
  ) {}

  async purgeUser(
    user: AccountLifecycleUser,
    options: AccountPurgeOptions,
  ): Promise<AccountPurgeResult> {
    const userId = new ObjectId(user._id.toString());
    const cleanup: ContentCleanupResult = { posts: [], imageAssets: [] };

    // Capture followers before any destructive participant runs. The snapshot is
    // used by the terminal lifecycle event after all mutations complete.
    const followerPublicIds =
      await this.socialCleanupParticipant.captureFollowerPublicIds(userId);

    const contentCleanup = await this.contentCleanupParticipant.cleanup(
      user,
      options.action,
    );
    appendCleanup(cleanup, contentCleanup);

    const affectedRelationshipPublicIds =
      await this.socialCleanupParticipant.removeRelationshipsAndActivity(
        userId,
        user.publicId,
      );

    const preservedConversationCount =
      await this.conversationCleanupParticipant.preserve(user, options.action);

    appendCleanup(
      cleanup,
      await this.communityCleanupParticipant.cleanup(userId),
    );

    const recordImageAssets = await this.recordCleanupParticipant.finalize(
      user,
      options,
    );
    appendCleanup(cleanup, { posts: [], imageAssets: recordImageAssets });

    const result: AccountPurgeResult = {
      deletedPosts: cleanup.posts,
      imageAssets: cleanup.imageAssets,
      followerPublicIds,
      affectedRelationshipPublicIds,
      reconciledPostLikes: contentCleanup.reconciledPostLikes,
      tombstonedCommentCount: contentCleanup.tombstonedCommentCount,
      preservedConversationCount,
    };

    // queueTransactional still runs inside the caller's UnitOfWork context, so
    // the existing outbox atomicity and ordering remain part of this transaction.
    await this.outboxParticipant.enqueue(user, options, result);
    return result;
  }
}
