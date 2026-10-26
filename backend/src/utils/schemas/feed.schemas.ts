import { z } from "zod";
import { MAX_FEED_CURSOR_ENCODED_LENGTH } from "@/utils/feedCursor";
import { isInterestId, INTERESTS } from "@/services/feed/interests.policy";

const feedPaginationBaseSchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(MAX_FEED_CURSOR_ENCODED_LENGTH)
      .optional(),
  })
  .strict();

export const feedPaginationQuerySchema = feedPaginationBaseSchema;

const interestId = z.string().refine(isInterestId, "Unknown interest");
export const interestFeedQuerySchema = feedPaginationBaseSchema.omit({ page: true }).extend({
  topics: z.preprocess(
    (value) => value === undefined ? [] : typeof value === "string" ? [value] : value,
    z.array(interestId).max(INTERESTS.length),
  ).transform((topics) => [...new Set(topics)].sort()),
  sort: z.enum(["newest", "top"]).optional().default("newest"),
});
export const selectInterestsSchema = z.object({ selected: z.array(interestId).max(INTERESTS.length) }).strict();
export type InterestFeedQuery = z.infer<typeof interestFeedQuerySchema>;
export type SelectInterestsBody = z.infer<typeof selectInterestsSchema>;

export const feedPreviewQuerySchema = feedPaginationBaseSchema.omit({ page: true }).extend({
  topics: z.preprocess(
    (value) => value === undefined ? [] : typeof value === "string" ? [value] : value,
    z.array(z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N}_]+$/u)).max(5),
  ).transform((topics) => [...new Set(topics.map((topic) => topic.toLowerCase()))].sort()),
  sort: z.enum(["latest", "relevant"]).optional().default("latest"),
  includeReposts: z.enum(["true", "false"]).optional().default("true")
    .transform((value) => value === "true"),
});

export const newFeedQuerySchema = feedPaginationBaseSchema.extend({
  refresh: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
});

export const trendingTagsQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(50).optional().default(5),
    timeWindowHours: z.coerce.number().int().positive().optional().default(168),
  })
  .strict();

export type FeedPaginationQuery = z.infer<typeof feedPaginationQuerySchema>;
export type FeedPreviewQuery = z.infer<typeof feedPreviewQuerySchema>;
export type NewFeedQuery = z.infer<typeof newFeedQuerySchema>;
export type TrendingTagsQuery = z.infer<typeof trendingTagsQuerySchema>;
