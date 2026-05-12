import { z } from "zod";
import { sanitizeForMongo, sanitize } from "@/utils/sanitizers";

const parentIdField = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid parent comment ID format.")
  .optional();

export const createCommentSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty.")
      .max(250, "Comment cannot be longer than 250 characters.")
      .transform(sanitize),
    parentId: parentIdField,
  })
  .strict()
  .transform(sanitizeForMongo);

export const updateCommentSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty.")
      .max(250, "Comment cannot be longer than 250 characters.")
      .transform(sanitize),
  })
  .strict()
  .transform(sanitizeForMongo);

export const commentIdSchema = z
  .object({
    commentId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid comment ID format."),
  })
  .strict();

export const commentsQuerySchema = z
  .object({
    parentId: parentIdField,
    page: z.coerce.number().int().min(1).max(100).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  })
  .strict()
  .transform(sanitizeForMongo);

export const userCommentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    sortBy: z.enum(["createdAt", "updatedAt"]).optional().default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  })
  .strict();

export type CreateCommentBody = z.infer<typeof createCommentSchema>;
export type UpdateCommentBody = z.infer<typeof updateCommentSchema>;
export type CommentIdParams = z.infer<typeof commentIdSchema>;
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;
export type UserCommentsQuery = z.infer<typeof userCommentsQuerySchema>;
