import { z } from "zod";

export const notificationQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    before: z.coerce.date().optional(),
  })
  .strict();

export const notificationIdSchema = z
  .object({
    notificationId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid notification ID format."),
  })
  .strict();

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationIdParams = z.infer<typeof notificationIdSchema>;
