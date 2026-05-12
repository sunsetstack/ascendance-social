import { z } from "zod";
import { sanitize, sanitizeForMongo } from "@/utils/sanitizers";

const adminSortOrderSchema = z.enum(["asc", "desc"]);

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const adminUsersQuerySchema = paginationSchema
  .extend({
    sortBy: z.enum(["createdAt", "updatedAt", "username", "email"]).optional(),
    sortOrder: adminSortOrderSchema.optional(),
    search: z.string().trim().max(100).transform(sanitize).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .strict();

export const adminImagesQuerySchema = paginationSchema
  .extend({
    limit: z.coerce.number().int().positive().max(100).optional().default(10),
    sortBy: z.enum(["createdAt", "updatedAt", "title"]).optional(),
    sortOrder: adminSortOrderSchema.optional(),
  })
  .strict();

export const recentActivityQuerySchema = paginationSchema
  .extend({
    limit: z.coerce.number().int().positive().max(100).optional().default(10),
  })
  .strict();

export const requestLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
    userId: z.string().trim().min(1).optional(),
    statusCode: z.coerce.number().int().min(100).max(599).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    search: z.string().trim().max(200).transform(sanitize).optional(),
  })
  .strict();

export const cacheClearQuerySchema = z
  .object({
    pattern: z.string().trim().min(1).optional(),
  })
  .strict();

export const banUserBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "Ban reason is required")
      .max(500)
      .transform(sanitize),
  })
  .strict()
  .transform(sanitizeForMongo);

export const adminFavoriteParamsSchema = z
  .object({
    publicId: z.string().uuid("Invalid user public ID format."),
    postPublicId: z.string().uuid("Invalid post public ID format."),
  })
  .strict();

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminImagesQuery = z.infer<typeof adminImagesQuerySchema>;
export type RecentActivityQuery = z.infer<typeof recentActivityQuerySchema>;
export type RequestLogsQuery = z.infer<typeof requestLogsQuerySchema>;
export type CacheClearQuery = z.infer<typeof cacheClearQuerySchema>;
export type BanUserBody = z.infer<typeof banUserBodySchema>;
export type AdminFavoriteParams = z.infer<typeof adminFavoriteParamsSchema>;
