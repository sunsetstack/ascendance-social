import { getRequestContext } from "@/runtime/request-context";
import { getTransactionTrace } from "@/database/UnitOfWork";
import { logger } from "@/utils/winston";

export function isFeedTraceEnabled(): boolean {
  return process.env.FEED_TRACE_ENABLED === "true" ||
    (process.env.FEED_TRACE_ENABLED === undefined && (process.env.NODE_ENV ?? "development") === "development");
}

export function traceFeed(event: string, details: Record<string, unknown>): void {
  if (!isFeedTraceEnabled()) return;
  const context = getRequestContext();
  logger.info("Feed trace", { event, ...getTransactionTrace(),
    clientRequestId: context?.clientRequestId, causedByClientRequestId: context?.causedByClientRequestId,
    ...details });
}
