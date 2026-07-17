import { decodeCursor, encodeCursor } from "@/utils/cursorCodec";
import { Errors } from "@/utils/errors";

export const FEED_CURSOR_VERSION = 1;

export const FEED_CURSOR_ORDER = {
  NEW: "new-created-at-id-desc-v1",
  PERSONALIZED: "personalized-created-at-id-desc-v1",
  PERSONALIZED_RANKED: "personalized-rank-score-id-desc-v1",
  FOR_YOU: "for-you-rank-score-id-desc-v1",
  TRENDING: "trending-score-id-desc-v1",
  TRENDING_NEW: "trending-new-created-at-id-desc-v1",
} as const;

export type FeedCursorFeed = "new" | "personalized" | "for-you" | "trending";
export type FeedCursorSource = "mongo" | "redis";
export type FeedCursorOrder =
  (typeof FEED_CURSOR_ORDER)[keyof typeof FEED_CURSOR_ORDER];

export interface FeedCursorPendingItem {
  _id: string;
}

export interface FeedCursorPayload extends Record<string, unknown> {
  version: number;
  feed: FeedCursorFeed;
  order: FeedCursorOrder;
  source: FeedCursorSource;
  phase?: "personalized" | "backfill" | "trending" | "new";
  asOf?: string;
  createdAt?: string;
  _id?: string;
  rankScore?: number;
  trendScore?: number;
  score?: number;
  seen?: string[];
  seenPublicIds?: string[];
  pending?: FeedCursorPendingItem[];
}

type FeedCursorInput = Omit<FeedCursorPayload, "version">;

export function encodeFeedCursor(payload: FeedCursorInput): string {
  return encodeCursor({ version: FEED_CURSOR_VERSION, ...payload });
}

export function encodeTrendingNewCursor(payload: FeedCursorInput): string {
  return `new_phase:${encodeFeedCursor(payload)}`;
}

export function decodeFeedCursor(
  cursor: string,
  expected: {
    feed: FeedCursorFeed;
    orders: readonly FeedCursorOrder[];
    source?: FeedCursorSource;
  },
): FeedCursorPayload {
  const hasTrendingNewEnvelope = cursor.startsWith("new_phase:");
  if (hasTrendingNewEnvelope && expected.feed !== "trending") {
    throw Errors.validation("Feed cursor does not match this feed");
  }
  const token = hasTrendingNewEnvelope
    ? cursor.slice("new_phase:".length)
    : cursor;
  const decoded = decodeCursor<Record<string, unknown>>(token);

  if (!decoded) {
    throw Errors.validation("Invalid feed cursor");
  }
  if (decoded.version !== FEED_CURSOR_VERSION) {
    throw Errors.validation("Unsupported feed cursor version");
  }
  if (decoded.feed !== expected.feed) {
    throw Errors.validation("Feed cursor does not match this feed");
  }
  if (
    typeof decoded.order !== "string" ||
    !expected.orders.includes(decoded.order as FeedCursorOrder)
  ) {
    throw Errors.validation("Feed cursor ordering is not supported");
  }
  if (
    hasTrendingNewEnvelope &&
    decoded.order !== FEED_CURSOR_ORDER.TRENDING_NEW
  ) {
    throw Errors.validation("Feed cursor ordering is not supported");
  }
  if (
    (decoded.source !== "mongo" && decoded.source !== "redis") ||
    (expected.source !== undefined && decoded.source !== expected.source)
  ) {
    throw Errors.validation("Feed cursor source is not supported");
  }

  assertOptionalString(decoded, "phase");
  if (
    decoded.phase !== undefined &&
    decoded.phase !== "personalized" &&
    decoded.phase !== "backfill" &&
    decoded.phase !== "trending" &&
    decoded.phase !== "new"
  ) {
    throw Errors.validation("Invalid feed cursor");
  }
  assertOptionalDate(decoded, "asOf");
  assertOptionalDate(decoded, "createdAt");
  assertOptionalString(decoded, "_id");
  assertOptionalNumber(decoded, "rankScore");
  assertOptionalNumber(decoded, "trendScore");
  assertOptionalNumber(decoded, "score");
  assertOptionalStringArray(decoded, "seen");
  assertOptionalStringArray(decoded, "seenPublicIds");
  assertOptionalPending(decoded);
  assertContinuationState(decoded as FeedCursorPayload);

  return decoded as FeedCursorPayload;
}

function assertContinuationState(cursor: FeedCursorPayload): void {
  const hasHistory =
    (cursor.seen?.length ?? 0) > 0 ||
    (cursor.seenPublicIds?.length ?? 0) > 0;

  if (cursor.source === "redis") {
    const score =
      cursor.order === FEED_CURSOR_ORDER.FOR_YOU
        ? cursor.score
        : cursor.trendScore;
    if (score === undefined || !cursor._id) {
      throw Errors.validation("Invalid feed cursor");
    }
    return;
  }

  if (cursor.order === FEED_CURSOR_ORDER.PERSONALIZED) {
    if (!cursor.createdAt || !cursor._id) {
      throw Errors.validation("Invalid feed cursor");
    }
    return;
  }

  if (
    cursor.order === FEED_CURSOR_ORDER.NEW ||
    cursor.order === FEED_CURSOR_ORDER.TRENDING_NEW
  ) {
    const hasCreatedAtAnchor = cursor.createdAt !== undefined;
    const hasIdAnchor = cursor._id !== undefined;
    if (hasCreatedAtAnchor !== hasIdAnchor || (!hasIdAnchor && !hasHistory)) {
      throw Errors.validation("Invalid feed cursor");
    }
    return;
  }

  const score =
    cursor.order === FEED_CURSOR_ORDER.TRENDING
      ? cursor.trendScore
      : cursor.rankScore;
  const hasScoreAnchor = score !== undefined;
  const hasIdAnchor = cursor._id !== undefined;
  if (hasScoreAnchor !== hasIdAnchor || (!hasIdAnchor && !hasHistory)) {
    throw Errors.validation("Invalid feed cursor");
  }
}

function assertOptionalString(
  payload: Record<string, unknown>,
  key: string,
): void {
  if (payload[key] !== undefined && typeof payload[key] !== "string") {
    throw Errors.validation("Invalid feed cursor");
  }
}

function assertOptionalNumber(
  payload: Record<string, unknown>,
  key: string,
): void {
  if (
    payload[key] !== undefined &&
    (typeof payload[key] !== "number" || !Number.isFinite(payload[key]))
  ) {
    throw Errors.validation("Invalid feed cursor");
  }
}

function assertOptionalDate(
  payload: Record<string, unknown>,
  key: string,
): void {
  assertOptionalString(payload, key);
  const value = payload[key];
  if (typeof value === "string" && Number.isNaN(new Date(value).getTime())) {
    throw Errors.validation("Invalid feed cursor");
  }
}

function assertOptionalStringArray(
  payload: Record<string, unknown>,
  key: string,
): void {
  const value = payload[key];
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
  ) {
    throw Errors.validation("Invalid feed cursor");
  }
}

function assertOptionalPending(payload: Record<string, unknown>): void {
  const pending = payload.pending;
  if (pending === undefined) return;
  if (!Array.isArray(pending)) {
    throw Errors.validation("Invalid feed cursor");
  }
  for (const entry of pending) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>)._id !== "string"
    ) {
      throw Errors.validation("Invalid feed cursor");
    }
  }
}
