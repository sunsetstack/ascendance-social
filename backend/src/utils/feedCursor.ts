import { createHash } from "crypto";
import {
  decodeAuthenticatedCursor,
  encodeAuthenticatedCursor,
} from "@/utils/cursorCodec";
import { Errors } from "@/utils/errors";

export const FEED_CURSOR_VERSION = 2;
export const MAX_FEED_CURSOR_ENCODED_LENGTH = 2_048;
export const FEED_CURSOR_TTL_SECONDS = 60 * 60;
export const FEED_CURSOR_SNAPSHOT_TTL_SECONDS = FEED_CURSOR_TTL_SECONDS;
export const FEED_CURSOR_SNAPSHOT_GENERATION_SECONDS = 5 * 60;

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

interface FeedCursorBase {
  version: typeof FEED_CURSOR_VERSION;
  feed: FeedCursorFeed;
  order: FeedCursorOrder;
  source: FeedCursorSource;
  expiresAt: number;
}

export interface NewFeedCursorPayload extends FeedCursorBase {
  feed: "new";
  order: typeof FEED_CURSOR_ORDER.NEW;
  source: "mongo";
  phase: "new";
  createdAt?: string;
  _id?: string;
  snapshotId?: string;
}

export interface PersonalizedFeedCursorPayload extends FeedCursorBase {
  feed: "personalized";
  order: typeof FEED_CURSOR_ORDER.PERSONALIZED;
  source: "mongo";
  phase: "personalized" | "backfill";
  createdAt: string;
  _id: string;
  scope: string;
}

export interface PersonalizedRankedFeedCursorPayload extends FeedCursorBase {
  feed: "personalized";
  order: typeof FEED_CURSOR_ORDER.PERSONALIZED_RANKED;
  source: "mongo";
  snapshotId: string;
  offset: number;
  scope: string;
}

export interface ForYouFeedCursorPayload extends FeedCursorBase {
  feed: "for-you";
  order: typeof FEED_CURSOR_ORDER.FOR_YOU;
  source: FeedCursorSource;
  snapshotId: string;
  offset: number;
  scope: string;
}

export interface TrendingFeedCursorPayload extends FeedCursorBase {
  feed: "trending";
  order: typeof FEED_CURSOR_ORDER.TRENDING;
  source: FeedCursorSource;
  phase: "trending";
  snapshotId: string;
  offset: number;
}

export interface TrendingNewFeedCursorPayload extends FeedCursorBase {
  feed: "trending";
  order: typeof FEED_CURSOR_ORDER.TRENDING_NEW;
  source: "mongo";
  phase: "new";
  snapshotId: string;
  createdAt?: string;
  _id?: string;
}

export type FeedCursorPayload =
  | NewFeedCursorPayload
  | PersonalizedFeedCursorPayload
  | PersonalizedRankedFeedCursorPayload
  | ForYouFeedCursorPayload
  | TrendingFeedCursorPayload
  | TrendingNewFeedCursorPayload;

type FeedCursorInput = FeedCursorPayload extends infer Payload
  ? Payload extends FeedCursorPayload
    ? Omit<Payload, "version" | "expiresAt">
    : never
  : never;

export interface FeedCursorSnapshotEntry {
  _id: string;
  publicId: string;
  visibleIdentityId: string;
  score?: number;
}

export interface FeedCursorSnapshot {
  version: 1;
  feed: FeedCursorFeed;
  order: FeedCursorOrder;
  source: FeedCursorSource;
  scope?: string;
  entries: FeedCursorSnapshotEntry[];
  excludedIdentityIds?: string[];
}

const BASE_KEYS = ["version", "feed", "order", "source", "expiresAt"];
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9_-]{43}\.[0-9]{1,12}$/;
const MAX_OFFSET = 1_000_000;

export function encodeFeedCursor(payload: FeedCursorInput): string {
  return encodeFeedCursorPayload(payload, false);
}

export function encodeTrendingNewCursor(payload: FeedCursorInput): string {
  const encoded = `new_phase:${encodeFeedCursorPayload(payload, true)}`;
  if (encoded.length > MAX_FEED_CURSOR_ENCODED_LENGTH) {
    throw Errors.validation("Feed cursor exceeds the maximum encoded size");
  }
  return encoded;
}

function encodeFeedCursorPayload(
  payload: FeedCursorInput,
  hasTrendingNewEnvelope: boolean,
): string {
  const complete = {
    ...payload,
    version: FEED_CURSOR_VERSION,
    expiresAt: Math.floor(Date.now() / 1000) + FEED_CURSOR_TTL_SECONDS,
  } as Record<string, unknown>;
  assertFeedCursorPayload(complete, hasTrendingNewEnvelope);
  const encoded = encodeAuthenticatedCursor(complete, getFeedCursorSecret());
  if (encoded.length > MAX_FEED_CURSOR_ENCODED_LENGTH) {
    throw Errors.validation("Feed cursor exceeds the maximum encoded size");
  }
  return encoded;
}

export function decodeFeedCursor<
  Feed extends FeedCursorFeed,
  Order extends FeedCursorOrder,
>(
  cursor: string,
  expected: {
    feed: Feed;
    orders: readonly Order[];
    source?: FeedCursorSource;
  },
): Extract<FeedCursorPayload, { feed: Feed; order: Order }>;
export function decodeFeedCursor(
  cursor: string,
  expected: {
    feed: FeedCursorFeed;
    orders: readonly FeedCursorOrder[];
    source?: FeedCursorSource;
  },
): FeedCursorPayload {
  if (cursor.length > MAX_FEED_CURSOR_ENCODED_LENGTH) {
    throw Errors.validation("Feed cursor exceeds the maximum encoded size");
  }

  const hasTrendingNewEnvelope = cursor.startsWith("new_phase:");
  if (hasTrendingNewEnvelope && expected.feed !== "trending") {
    throw Errors.validation("Feed cursor does not match this feed");
  }
  const token = hasTrendingNewEnvelope
    ? cursor.slice("new_phase:".length)
    : cursor;
  const decoded = decodeAuthenticatedCursor<Record<string, unknown>>(
    token,
    getFeedCursorSecret(),
  );

  if (!decoded) {
    throw Errors.validation("Invalid or unauthenticated feed cursor");
  }

  const payload = assertFeedCursorPayload(decoded, hasTrendingNewEnvelope);
  if (payload.feed !== expected.feed) {
    throw Errors.validation("Feed cursor does not match this feed");
  }
  if (!expected.orders.includes(payload.order)) {
    throw Errors.validation("Feed cursor ordering is not supported");
  }
  if (expected.source !== undefined && payload.source !== expected.source) {
    throw Errors.validation("Feed cursor source is not supported");
  }
  return payload;
}

export function hashFeedCursorScope(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

function assertFeedCursorPayload(
  payload: Record<string, unknown>,
  hasTrendingNewEnvelope: boolean,
): FeedCursorPayload {
  if (payload.version !== FEED_CURSOR_VERSION) {
    throw Errors.validation("Unsupported feed cursor version");
  }
  assertExpiry(payload.expiresAt);

  switch (payload.order) {
    case FEED_CURSOR_ORDER.NEW:
      assertExactKeys(payload, [
        ...BASE_KEYS,
        "phase",
        "createdAt",
        "_id",
        "snapshotId",
      ]);
      assertLiteral(payload.feed, "new");
      assertLiteral(payload.source, "mongo");
      assertLiteral(payload.phase, "new");
      assertOptionalAnchor(payload);
      assertOptionalSnapshotId(payload.snapshotId);
      if (payload.createdAt === undefined && payload.snapshotId === undefined) {
        throw Errors.validation("Invalid feed cursor continuation state");
      }
      if (hasTrendingNewEnvelope) {
        throw Errors.validation("Feed cursor ordering is not supported");
      }
      return payload as unknown as NewFeedCursorPayload;

    case FEED_CURSOR_ORDER.PERSONALIZED:
      assertExactKeys(payload, [
        ...BASE_KEYS,
        "phase",
        "createdAt",
        "_id",
        "scope",
      ]);
      assertLiteral(payload.feed, "personalized");
      assertLiteral(payload.source, "mongo");
      if (payload.phase !== "personalized" && payload.phase !== "backfill") {
        throw Errors.validation("Invalid personalized feed cursor phase");
      }
      assertRequiredAnchor(payload);
      assertHash(payload.scope, "scope");
      assertNoTrendingEnvelope(hasTrendingNewEnvelope);
      return payload as unknown as PersonalizedFeedCursorPayload;

    case FEED_CURSOR_ORDER.PERSONALIZED_RANKED:
      assertSnapshotCursor(payload, "personalized", "mongo", true);
      assertNoTrendingEnvelope(hasTrendingNewEnvelope);
      return payload as unknown as PersonalizedRankedFeedCursorPayload;

    case FEED_CURSOR_ORDER.FOR_YOU:
      assertSnapshotCursor(payload, "for-you", undefined, true);
      assertNoTrendingEnvelope(hasTrendingNewEnvelope);
      return payload as unknown as ForYouFeedCursorPayload;

    case FEED_CURSOR_ORDER.TRENDING:
      assertExactKeys(payload, [
        ...BASE_KEYS,
        "phase",
        "snapshotId",
        "offset",
      ]);
      assertLiteral(payload.feed, "trending");
      assertFeedSource(payload.source);
      assertLiteral(payload.phase, "trending");
      assertSnapshotId(payload.snapshotId);
      assertOffset(payload.offset);
      assertNoTrendingEnvelope(hasTrendingNewEnvelope);
      return payload as unknown as TrendingFeedCursorPayload;

    case FEED_CURSOR_ORDER.TRENDING_NEW:
      assertExactKeys(payload, [
        ...BASE_KEYS,
        "phase",
        "snapshotId",
        "createdAt",
        "_id",
      ]);
      assertLiteral(payload.feed, "trending");
      assertLiteral(payload.source, "mongo");
      assertLiteral(payload.phase, "new");
      assertSnapshotId(payload.snapshotId);
      assertOptionalAnchor(payload);
      if (!hasTrendingNewEnvelope) {
        throw Errors.validation("Feed cursor ordering is not supported");
      }
      return payload as unknown as TrendingNewFeedCursorPayload;

    default:
      throw Errors.validation("Feed cursor ordering is not supported");
  }
}

function assertSnapshotCursor(
  payload: Record<string, unknown>,
  feed: "personalized" | "for-you",
  source: FeedCursorSource | undefined,
  requiresScope: boolean,
): void {
  assertExactKeys(payload, [
    ...BASE_KEYS,
    "snapshotId",
    "offset",
    ...(requiresScope ? ["scope"] : []),
  ]);
  assertLiteral(payload.feed, feed);
  if (source === undefined) {
    assertFeedSource(payload.source);
  } else {
    assertLiteral(payload.source, source);
  }
  assertSnapshotId(payload.snapshotId);
  assertOffset(payload.offset);
  if (requiresScope) assertHash(payload.scope, "scope");
}

function assertExactKeys(
  payload: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw Errors.validation("Feed cursor contains unknown properties");
  }
}

function assertRequiredAnchor(payload: Record<string, unknown>): void {
  assertDate(payload.createdAt);
  assertObjectId(payload._id);
}

function assertOptionalAnchor(payload: Record<string, unknown>): void {
  const hasCreatedAt = payload.createdAt !== undefined;
  const hasId = payload._id !== undefined;
  if (hasCreatedAt !== hasId) {
    throw Errors.validation("Invalid feed cursor anchor");
  }
  if (hasCreatedAt) assertRequiredAnchor(payload);
}

function assertDate(value: unknown): void {
  if (typeof value !== "string" || value.length > 32) {
    throw Errors.validation("Invalid feed cursor date");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw Errors.validation("Invalid feed cursor date");
  }
}

function assertObjectId(value: unknown): void {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
    throw Errors.validation("Invalid feed cursor identity");
  }
}

function assertHash(value: unknown, field: string): void {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw Errors.validation(`Invalid feed cursor ${field}`);
  }
}

function assertSnapshotId(value: unknown): void {
  if (typeof value !== "string" || !SNAPSHOT_ID_PATTERN.test(value)) {
    throw Errors.validation("Invalid feed cursor snapshot");
  }
}

function assertOptionalSnapshotId(value: unknown): void {
  if (value !== undefined) assertSnapshotId(value);
}

function assertOffset(value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_OFFSET
  ) {
    throw Errors.validation("Invalid feed cursor offset");
  }
}

function assertExpiry(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw Errors.validation("Invalid feed cursor expiry");
  }
  if (value <= Math.floor(Date.now() / 1000)) {
    throw Errors.validation("Feed cursor has expired");
  }
}

function assertLiteral<T extends string>(value: unknown, expected: T): void {
  if (value !== expected) {
    throw Errors.validation("Invalid feed cursor variant");
  }
}

function assertFeedSource(value: unknown): asserts value is FeedCursorSource {
  if (value !== "mongo" && value !== "redis") {
    throw Errors.validation("Feed cursor source is not supported");
  }
}

function assertNoTrendingEnvelope(hasTrendingNewEnvelope: boolean): void {
  if (hasTrendingNewEnvelope) {
    throw Errors.validation("Feed cursor ordering is not supported");
  }
}

function getFeedCursorSecret(): string {
  const secret = process.env.FEED_CURSOR_SECRET ?? process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "test") {
    return "ascendance-feed-cursor-test-secret-v2";
  }
  throw Errors.config("FEED_CURSOR_SECRET or JWT_SECRET must be configured");
}
