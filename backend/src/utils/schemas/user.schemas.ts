import { z } from "zod";
import { sanitizeForMongo, sanitizeTextInput } from "@/utils/sanitizers";

export const publicIdSchema = z
  .object({
    publicId: z.string().uuid("Invalid public ID format."),
  })
  .strict();

export const usernameSchema = z
  .object({
    username: z
      .string()
      .regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric.")
      .min(1)
      .max(30),
  })
  .strict();

export const handleSchema = z
  .object({
    handle: z
      .string()
      .regex(
        /^[a-zA-Z0-9._]+$/,
        "Handle must be alphanumeric and may include dots or underscores.",
      )
      .min(4)
      .max(16),
  })
  .strict();

export const handleSuggestionsSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(3, "Query must be at least 3 characters.")
      .max(30)
      .transform((value) => sanitizeTextInput(value, 30)),
    context: z.enum(["mention", "search"]),
    limit: z.coerce.number().int().positive().max(20).optional().default(8),
  })
  .strict()
  .transform(sanitizeForMongo);

export const usersQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    sortBy: z.string().trim().min(1).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export const publicUserListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

export const whoToFollowQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(20).optional().default(5),
  })
  .strict();

export const registrationSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    handle: z
      .string()
      .regex(
        /^[a-zA-Z0-9._]+$/,
        "Handle must be alphanumeric and may include dots or underscores.",
      )
      .min(4)
      .max(16),
    username: z
      .string()
      .regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric.")
      .min(1)
      .max(30),
    confirmPassword: z.string(),
    website: z.string().optional(),
  })
  .strict()
  .transform(sanitizeForMongo)
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string(),
    website: z.string().optional(),
  })
  .strict()
  .transform(sanitizeForMongo);

export const updateProfileSchema = z
  .object({
    username: z
      .string()
      .regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric.")
      .min(1)
      .max(30)
      .optional(),
    bio: z.string().max(500).optional(),
  })
  .strict()
  .transform(sanitizeForMongo);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string(),
    newPassword: z.string().min(8),
  })
  .strict()
  .transform(sanitizeForMongo);

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1, "Password is required"),
  })
  .strict()
  .transform(sanitizeForMongo);

export const requestPasswordResetSchema = z
  .object({
    email: z.string().email(),
    website: z.string().optional(),
  })
  .strict()
  .transform(sanitizeForMongo);

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .strict()
  .transform(sanitizeForMongo);

export const verifyEmailSchema = z
  .object({
    email: z.string().email(),
    token: z.string().regex(/^\d{5}$/, "Token must be 5 digits"),
  })
  .strict()
  .transform(sanitizeForMongo);

export type PublicIdParams = z.infer<typeof publicIdSchema>;
export type HandleParams = z.infer<typeof handleSchema>;
export type HandleSuggestionsQuery = z.infer<typeof handleSuggestionsSchema>;
export type UsersQuery = z.infer<typeof usersQuerySchema>;
export type PublicUserListQuery = z.infer<typeof publicUserListQuerySchema>;
export type WhoToFollowQuery = z.infer<typeof whoToFollowQuerySchema>;
export type RegistrationBody = z.infer<typeof registrationSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;
export type RequestPasswordResetBody = z.infer<
  typeof requestPasswordResetSchema
>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailBody = z.infer<typeof verifyEmailSchema>;
