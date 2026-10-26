export function isFeedTraceEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_FEED_TRACE_ENABLED === "true";
}

let cause: { id: string; at: number } | undefined;
const records: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
const REPORT_FIELDS = new Set(["clientRequestId", "causedByClientRequestId", "serverRequestId", "latestSuccessfulAction", "postPublicId", "path", "method", "status", "durationMs", "attempt", "code", "message", "stack", "affectedQueries", "shouldLike", "profileRefetch", "feedRefetch", "reason"]);

async function report(): Promise<void> {
  timer = undefined;
  if (sending || !records.length) return;
  sending = true;
  const events = records.splice(0, 25);
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/telemetry/feed-trace`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }),
    });
    if (!response.ok) throw new Error(`Feed trace ingestion returned ${response.status}`);
  } catch (error) {
    console.warn("[feed.trace.delivery_failed]", { count: events.length, error });
  } finally {
    sending = false;
    if (records.length) timer = setTimeout(() => void report(), 1000);
  }
}

export function rememberFeedAction(id: string): void {
  cause = { id, at: Date.now() };
}

export function latestFeedAction(): string | undefined {
  return cause && Date.now() - cause.at < 5 * 60_000 ? cause.id : undefined;
}

export function clearFeedAction(): void { cause = undefined; }

export function traceFeedClient(event: string, details: Record<string, unknown>): void {
  if (!isFeedTraceEnabled()) return;
  const at = new Date().toISOString();
  console.info("[feed.trace]", { event, at, ...details });
  if (records.length >= 250) {
    console.warn("[feed.trace.buffer_full]", { event });
    return;
  }
  records.push({ event, at, ...Object.fromEntries(Object.entries(details).filter(([key, value]) => REPORT_FIELDS.has(key) && value !== undefined)) });
  if (!timer && !sending) timer = setTimeout(() => void report(), 1000);
}
