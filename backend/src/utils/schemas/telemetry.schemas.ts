import { z } from "zod";

const isSafePath = (value: string): boolean => {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://visitor.invalid");
    return (
      !parsed.username &&
      !parsed.password &&
      parsed.origin === "https://visitor.invalid" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
};

const isSafeReferrer = (value: string): boolean => {
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return false;
  }

  try {
    const isRelativePath = value.startsWith("/") && !value.startsWith("//");
    if (!isRelativePath && !/^https?:\/\//i.test(value)) {
      return false;
    }

    const parsed = isRelativePath
      ? new URL(value, "https://visitor.invalid")
      : new URL(value);
    const isHttpUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
    return (
      (isRelativePath || isHttpUrl) &&
      !parsed.username &&
      !parsed.password &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
};

export const telemetryEventSchema = z
  .object({
    type: z.enum([
      "ttfi",
      "scroll_depth",
      "flow_start",
      "flow_complete",
      "flow_abandon",
    ]),
    timestamp: z.number().int().nonnegative(),
    sessionId: z.string().trim().min(1),
    data: z.record(z.unknown()).optional().default({}),
  })
  .strict();

export const visitorObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    path: z.string().trim().min(1).max(2_048).refine(isSafePath),
    referrer: z
      .string()
      .trim()
      .max(2_048)
      .refine(isSafeReferrer)
      .optional(),
    language: z.string().trim().max(32).optional(),
    languages: z.array(z.string().trim().max(32)).max(10).optional(),
    platform: z.string().trim().max(64).optional(),
    timezone: z.string().trim().max(64).optional(),
    screen: z
      .object({
        width: z.number().int().min(0).max(10_000),
        height: z.number().int().min(0).max(10_000),
        colorDepth: z.number().int().min(1).max(64),
      })
      .strict()
      .optional(),
    viewport: z
      .object({
        width: z.number().min(0).max(10_000),
        height: z.number().min(0).max(10_000),
      })
      .strict()
      .optional(),
    devicePixelRatio: z.number().min(0).max(100).optional(),
    hardwareConcurrency: z.number().int().min(0).max(256).optional(),
    deviceMemory: z.number().min(0).max(1_024).optional(),
    maxTouchPoints: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const telemetryBatchSchema = z
  .object({
    events: z.array(telemetryEventSchema).max(100),
    visitor: visitorObservationSchema.optional(),
  })
  .strict();

export type TelemetryBatchBody = z.infer<typeof telemetryBatchSchema>;
export type VisitorObservationBody = z.infer<typeof visitorObservationSchema>;
