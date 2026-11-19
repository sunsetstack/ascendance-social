import { z } from "zod";

const compoundCursor = z.string().regex(/^.+~[0-9a-f]{24}$/i)
  .transform((value) => {
    const [timestamp, id] = value.split("~");
    return { timestamp: new Date(timestamp!), id };
  })
  .refine(({ timestamp, id }) => !!id && Number.isFinite(timestamp.getTime()),
    "Invalid notification cursor");

export const notificationQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    before: z.union([
      compoundCursor,
      z.coerce.date().transform((timestamp) => ({ timestamp, id: undefined })),
    ]).optional(),
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
