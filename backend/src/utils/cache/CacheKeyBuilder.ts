/**
 * Union of valid per-user Redis feed types.
 * Only covers feeds stored under the `feed:{type}:{userId}` key pattern.
 * Global feeds (trending, new) use their own dedicated key builders.
 */
export type RedisFeedType = "for_you";

export class CacheKeyBuilder {
	static readonly PREFIXES = {
		USER_BATCH: "user_batch",
		USER_DATA: "user_data",
		POST_META: "post_meta",
		CORE_FEED: "core_feed",
		FOR_YOU_FEED: "for_you_feed",
		TRENDING_FEED: "trending_feed",
		NEW_FEED: "new_feed",
		REDIS_FEED: "feed",
		TRENDING_TAGS: "trending_tags",
		USER_FEED: "user_feed",
		USER_FOR_YOU: "user_for_you_feed",
		FOLLOWING_IDS: "following_ids",
		NOTIFICATION_LIST: "notifications:user",
		NOTIFICATION_HASH: "notification",
	};

	static getUserBatchKey(userPublicIds: string[]): string {
		return `${this.PREFIXES.USER_BATCH}:${userPublicIds.sort().join(",")}`;
	}

	static getUserDataKey(userPublicId: string): string {
		return `${this.PREFIXES.USER_DATA}:${userPublicId}`;
	}

	static getPostMetaKey(postPublicId: string): string {
		return `${this.PREFIXES.POST_META}:${postPublicId}`;
	}

	static getCoreFeedKey(userId: string, page: number, limit: number): string {
		return `${this.PREFIXES.CORE_FEED}:${userId}:${page}:${limit}`;
	}

	static getForYouFeedKey(userId: string, page: number, limit: number): string {
		return `${this.PREFIXES.FOR_YOU_FEED}:${userId}:${page}:${limit}`;
	}

	static getTrendingFeedKey(page: number, limit: number): string {
		return `${this.PREFIXES.TRENDING_FEED}:${page}:${limit}`;
	}

	static getTrendingFeedTag(): string {
		return this.PREFIXES.TRENDING_FEED;
	}

	static getTrendingFeedPattern(): string {
		return `${this.PREFIXES.TRENDING_FEED}:*`;
	}

	static getNewFeedKey(page: number, limit: number): string {
		return `${this.PREFIXES.NEW_FEED}:${page}:${limit}`;
	}

	static getNewFeedCursorKey(cursor: string, limit: number): string {
		return `${this.PREFIXES.NEW_FEED}:cursor:${cursor}:${limit}`;
	}

	static getNewFeedTag(): string {
		return this.PREFIXES.NEW_FEED;
	}

	static getFeedPageTag(page: number): string {
		return `page:${page}`;
	}

	static getFeedLimitTag(limit: number): string {
		return `limit:${limit}`;
	}

	static getUserFeedTag(userId: string): string {
		return `${this.PREFIXES.USER_FEED}:${userId}`;
	}

	static getUserForYouFeedTag(userId: string): string {
		return `${this.PREFIXES.USER_FOR_YOU}:${userId}`;
	}

	static getFollowingIdsKey(userId: string): string {
		return `${this.PREFIXES.FOLLOWING_IDS}:${userId}`;
	}

	static getRedisFeedKey(feedType: RedisFeedType, userId: string): string {
		return `${this.PREFIXES.REDIS_FEED}:${feedType}:${userId}`;
	}

	static getUserFeedPatterns(userId: string): string[] {
		return [this.getCoreFeedKeyPattern(userId), this.getForYouFeedKeyPattern(userId)];
	}

	static getCoreFeedKeyPattern(userId: string): string {
		return `${this.PREFIXES.CORE_FEED}:${userId}:*`;
	}

	static getForYouFeedKeyPattern(userId: string): string {
		return `${this.PREFIXES.FOR_YOU_FEED}:${userId}:*`;
	}

	static getGlobalFeedPatterns(includeNewFeed = false): string[] {
		const patterns = [
			`${this.PREFIXES.CORE_FEED}:*`,
			`${this.PREFIXES.FOR_YOU_FEED}:*`,
			this.getTrendingFeedPattern(),
		];
		if (includeNewFeed) {
			patterns.push(`${this.PREFIXES.NEW_FEED}:*`);
		}
		return patterns;
	}

	static getTrendingTagsKey(limit: number, timeWindow: number): string {
		return `${this.PREFIXES.TRENDING_TAGS}:${limit}:${timeWindow}`;
	}

	static getTrendingTagsPrefix(): string {
		return `${this.PREFIXES.TRENDING_TAGS}`;
	}

	static getNotificationListKey(userId: string): string {
		return `${this.PREFIXES.NOTIFICATION_LIST}:${userId}`;
	}

	static getNotificationHashKey(id: string): string {
		return `${this.PREFIXES.NOTIFICATION_HASH}:${id}`;
	}
}
