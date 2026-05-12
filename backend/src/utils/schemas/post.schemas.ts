import { z } from "zod";
import { sanitizeForMongo, sanitize } from "@/utils/sanitizers";

export const createPostSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Body cannot be empty.")
      .max(300, "Body cannot be longer than 300 characters.")
      .transform(sanitize)
      .optional(),
    tags: z.preprocess(
      (val) => {
        if (typeof val === "string") {
          try {
            const parsed = JSON.parse(val);
            if (
              Array.isArray(parsed) &&
              parsed.every((item) => typeof item === "string")
            ) {
              return parsed;
            }
          } catch {
            // if cant parse return empty arr
            return [];
          }
        }
        return Array.isArray(val) ? val : [];
      },
      z
        .array(z.string().trim().min(1).max(20))
        .max(5, "You can add up to 5 tags.")
        .default([]),
    ),
    communityPublicId: z
      .string()
      .uuid("Invalid community ID format.")
      .optional(),
  })
  .passthrough() // allow extra fields from multer
  .transform((data) => {
    // strip dangerous keys after passthrough
    const cleaned = sanitizeForMongo(data);
    // only return relevant filds
    return {
      body: cleaned.body,
      tags: cleaned.tags,
      communityPublicId: cleaned.communityPublicId,
    };
  });

export const slugSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "Slug cannot be empty.")
      .regex(
        /^[a-z0-9-]+$/,
        "Slug can only contain lowercase letters, numbers, and hyphens.",
      ),
  })
  .strict();

export const publicIdSchema = z
  .object({
    publicId: z.string().uuid("Invalid public ID format."),
  })
  .strict();

export const postPublicIdSchema = z
  .object({
    postPublicId: z.string().uuid("Invalid post public ID format."),
  })
  .strict();

const postSortFieldSchema = z.enum(["createdAt", "updatedAt", "likesCount"]);
const sortOrderSchema = z.enum(["asc", "desc"]);

export const listPostsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(9),
  })
  .strict();

export const userPostsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(10),
    sortBy: postSortFieldSchema.optional().default("createdAt"),
    sortOrder: sortOrderSchema.optional().default("desc"),
  })
  .strict();

export const handlePostsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

export const searchByTagsSchema = z
  .object({
    tags: z.string().trim().min(1, "Tags query cannot be empty."),
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().optional().default(10),
  })
  .strict();

export const repostSchema = z
  .object({
    body: z
      .string()
      .trim()
      .max(300, "Body cannot be longer than 300 characters.")
      .transform(sanitize)
      .optional(),
  })
  .strict()
  .transform(sanitizeForMongo);

export type CreatePostBody = z.infer<typeof createPostSchema>;
export type SlugParams = z.infer<typeof slugSchema>;
export type PublicIdParams = z.infer<typeof publicIdSchema>;
export type PostPublicIdParams = z.infer<typeof postPublicIdSchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
export type UserPostsQuery = z.infer<typeof userPostsQuerySchema>;
export type HandlePostsQuery = z.infer<typeof handlePostsQuerySchema>;
export type SearchByTagsQuery = z.infer<typeof searchByTagsSchema>;
export type RepostBody = z.infer<typeof repostSchema>;
