import { z } from "zod";
import { MAX_FEED_CURSOR_ENCODED_LENGTH } from "@/utils/feedCursor";

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
export type NewFeedQuery = z.infer<typeof newFeedQuerySchema>;
export type TrendingTagsQuery = z.infer<typeof trendingTagsQuerySchema>;
