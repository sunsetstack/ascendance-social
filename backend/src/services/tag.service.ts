import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TagRepository } from "@/repositories/tag.repository";
import { RedisService } from "./redis.service";
import { ITag } from "@/types/index";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

// key for tracking tag activity metrics
export const TAG_ACTIVITY_METRICS_KEY = "trending_tags:activity_metrics";

export interface TagActivityMetrics {
  // rolling count of tags used (with exponential decay)
  tagUsageCount: number;
  // timestamp of last update
  lastUpdated: number;
  // count of tag usages in the last hour (for rate calculation)
  recentUsageCount: number;
  // when the recent count window started
  recentWindowStart: number;
}

@injectable()
export class TagService {
  constructor(
    @inject(TOKENS.Repositories.Tag) private readonly tagRepository: TagRepository,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  /**
   * ensures tags exist in the database, creating them if necessary
   * returns the full tag documents
   */
  async ensureTagsExist(
    tagNames: string[],
  ): Promise<ITag[]> {
    if (!tagNames.length) {
      return [];
    }

    const unique = Array.from(
      new Set(tagNames.map((tag) => this.normalize(tag))).values(),
    ).filter(Boolean);
    if (unique.length === 0) return [];

    const existing = await this.tagRepository.findByTags(unique);
    const existingMap = new Map(existing.map((t) => [t.tag, t]));

    const tagDocs: ITag[] = [...existing];
    const missingTags = unique.filter((tag) => !existingMap.has(tag));

    if (missingTags.length > 0) {
      const created = await Promise.all(
        missingTags.map((tag) =>
          this.tagRepository.create(
            {
              tag,
              count: 0,
              modifiedAt: new Date(),
            } as Partial<ITag>,
          ),
        ),
      );
      tagDocs.push(...created);
    }

    return tagDocs;
  }

  /**
   * resolves tag names to their internal ObjectIds without creating new tags
   * returns only existing tag IDs
   */
  async resolveTagIds(tagNames: string[]): Promise<string[]> {
    const unique = Array.from(
      new Set(tagNames.map((tag) => this.normalize(tag))).values(),
    ).filter(Boolean);
    if (unique.length === 0) return [];

    const existing = await this.tagRepository.findByTags(unique);
    return existing.map((t) => t._id.toString());
  }

  /**
   * increments usage count for multiple tags atomically
   * also tracks activity metrics for dynamic TTL calculation
   */
  async incrementUsage(
    tagIds: mongoose.Types.ObjectId[],
  ): Promise<void> {
    if (!tagIds.length) return;

    const now = new Date();
    await Promise.all(
      tagIds.map((tagId) =>
        this.tagRepository.findOneAndUpdate(
          { _id: tagId },
          { $inc: { count: 1 }, $set: { modifiedAt: now } },
        ),
      ),
    );

    // track activity for dynamic TTL (fire and forget, don't block post creation)
    this.trackTagActivity(tagIds.length).catch((err) => {
      logger.warn("[TagService] Failed to track tag activity", err);
    });
  }

  /**
   * tracks tag usage activity for dynamic cache TTL calculation
   * uses exponential decay to weight recent activity more heavily
   */
  private async trackTagActivity(tagCount: number): Promise<void> {
    const now = Date.now();
    const oneHourMs = 3600000;

    try {
      const existing = await this.redisService.get<TagActivityMetrics>(
        TAG_ACTIVITY_METRICS_KEY,
      );

      if (existing) {
        const hoursSinceLastUpdate = (now - existing.lastUpdated) / oneHourMs;

        // exponential decay with ~24 hour half-life for rolling count
        const decayFactor = Math.exp(-hoursSinceLastUpdate / 24);
        const decayedCount = existing.tagUsageCount * decayFactor;

        // check if we need to reset the recent window (every hour)
        let recentUsageCount = existing.recentUsageCount;
        let recentWindowStart = existing.recentWindowStart;

        if (now - existing.recentWindowStart > oneHourMs) {
          // start a new window
          recentUsageCount = tagCount;
          recentWindowStart = now;
        } else {
          // add to current window
          recentUsageCount += tagCount;
        }

        await this.redisService.set(
          TAG_ACTIVITY_METRICS_KEY,
          {
            tagUsageCount: decayedCount + tagCount,
            lastUpdated: now,
            recentUsageCount,
            recentWindowStart,
          } as TagActivityMetrics,
          604800, // keep metrics for 1 week
        );
      } else {
        // first activity ever
        await this.redisService.set(
          TAG_ACTIVITY_METRICS_KEY,
          {
            tagUsageCount: tagCount,
            lastUpdated: now,
            recentUsageCount: tagCount,
            recentWindowStart: now,
          } as TagActivityMetrics,
          604800,
        );
      }

      logger.debug(`[TagService] Tracked ${tagCount} tag usages`);
    } catch (error) {
      // non-critical, just log
      logger.warn("[TagService] Error tracking tag activity", error);
    }
  }

  /**
   * decrements usage count for multiple tags atomically
   */
  async decrementUsage(
    tagIds: mongoose.Types.ObjectId[],
  ): Promise<void> {
    if (!tagIds.length) return;

    const now = new Date();
    await Promise.all(
      tagIds.map((tagId) =>
        this.tagRepository.findOneAndUpdate(
          { _id: tagId },
          { $inc: { count: -1 }, $set: { modifiedAt: now } },
        ),
      ),
    );
  }

  /**
   * extracts hashtags from text and combines with explicit tags
   */
  collectTagNames(body: string | undefined, explicitTags?: string[]): string[] {
    const hashtags = this.extractHashtags(body);
    const provided = Array.isArray(explicitTags) ? explicitTags : [];
    return [...hashtags, ...provided];
  }

  /**
   * extracts hashtags from text using regex
   */
  private extractHashtags(text?: string): string[] {
    if (!text) return [];
    const matches = text.match(/#([\p{L}\p{N}_-]+)/gu) || [];
    return matches.map((tag) => tag.substring(1));
  }

  /**
   * normalizes tag by removing leading hashes, trimming, and lowercasing
   */
  private normalize(tag?: string): string {
    if (!tag) return "";
    return tag.replace(/^#+/, "").trim().toLowerCase();
  }
}
