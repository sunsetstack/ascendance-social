import type { mongo } from "mongoose";
import type { AccountLifecycleAction } from "@/application/common/policies/account-lifecycle.policy";
import type {
  ContentCleanupResult,
  RemovedImageAsset,
  RemovedPostSummary,
} from "./content-cleanup.service";

export type ObjectId = mongo.ObjectId;

export interface AccountLifecycleUser {
  _id: ObjectId;
  publicId: string;
  handle?: string;
  username?: string;
  avatar?: string;
  cover?: string;
}

export interface AccountPurgeOptions {
  action: AccountLifecycleAction;
  reason: string;
  bannedBy?: ObjectId;
  /** The actor whose identity is recorded on lifecycle cleanup events. */
  requestedByPublicId?: string;
}

export interface AccountPurgeResult {
  deletedPosts: RemovedPostSummary[];
  imageAssets: RemovedImageAsset[];
  followerPublicIds: string[];
  affectedRelationshipPublicIds: string[];
  reconciledPostLikes: Array<{
    postPublicId: string;
    likesCount: number;
  }>;
  tombstonedCommentCount: number;
  preservedConversationCount: number;
}

export interface AccountContentCleanupResult extends ContentCleanupResult {
  reconciledPostLikes: Array<{
    postPublicId: string;
    likesCount: number;
  }>;
  tombstonedCommentCount: number;
}

export interface AccountContentCleanupParticipant {
  cleanup(
    user: AccountLifecycleUser,
    action: AccountLifecycleAction,
  ): Promise<AccountContentCleanupResult>;
}

export interface AccountSocialCleanupParticipant {
  captureFollowerPublicIds(userId: ObjectId): Promise<string[]>;
  removeRelationshipsAndActivity(
    userId: ObjectId,
    userPublicId: string,
  ): Promise<string[]>;
}

export interface AccountConversationCleanupParticipant {
  preserve(
    user: AccountLifecycleUser,
    action: AccountLifecycleAction,
  ): Promise<number>;
}

export interface AccountCommunityCleanupParticipant {
  cleanup(userId: ObjectId): Promise<ContentCleanupResult>;
}

export type AccountRecordCleanupOptions = Pick<
  AccountPurgeOptions,
  "action" | "reason" | "bannedBy"
>;

export interface AccountRecordCleanupParticipant {
  finalize(
    user: AccountLifecycleUser,
    options: AccountRecordCleanupOptions,
  ): Promise<RemovedImageAsset[]>;
}

export type AccountOutboxOptions = Pick<
  AccountPurgeOptions,
  "action" | "requestedByPublicId"
>;

export interface AccountOutboxParticipant {
  enqueue(
    user: AccountLifecycleUser,
    options: AccountOutboxOptions,
    result: AccountPurgeResult,
  ): Promise<void>;
}

export function appendCleanup(
  target: ContentCleanupResult,
  source: ContentCleanupResult,
): void {
  const knownPosts = new Set(
    target.posts.map((post) => post.internalId.toHexString()),
  );
  for (const post of source.posts) {
    if (!knownPosts.has(post.internalId.toHexString())) {
      target.posts.push(post);
      knownPosts.add(post.internalId.toHexString());
    }
  }

  const knownAssets = new Set(
    target.imageAssets.flatMap((asset) =>
      [asset.storagePublicId, asset.url].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  for (const asset of source.imageAssets) {
    const keys = [asset.storagePublicId, asset.url].filter(
      (value): value is string => Boolean(value),
    );
    if (keys.length > 0 && keys.every((key) => !knownAssets.has(key))) {
      target.imageAssets.push(asset);
      keys.forEach((key) => knownAssets.add(key));
    }
  }
}
