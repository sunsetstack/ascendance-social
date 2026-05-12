import { z } from "zod";

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

export const telemetryBatchSchema = z
  .object({
    events: z.array(telemetryEventSchema).max(100),
  })
  .strict();

export type TelemetryBatchBody = z.infer<typeof telemetryBatchSchema>;
