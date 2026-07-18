import { after, before, describe, it } from "mocha";
import { expect } from "chai";

import { encodeAuthenticatedCursor } from "@/utils/cursorCodec";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_ORDER,
  FEED_CURSOR_VERSION,
  hashFeedCursorScope,
  MAX_FEED_CURSOR_ENCODED_LENGTH,
} from "@/utils/feedCursor";

describe("feed cursor representation", () => {
  const secret = "feed-cursor-representation-test-secret";
  const originalSecret = process.env.FEED_CURSOR_SECRET;

  before(() => {
    process.env.FEED_CURSOR_SECRET = secret;
  });

  after(() => {
    if (originalSecret === undefined) {
      delete process.env.FEED_CURSOR_SECRET;
    } else {
      process.env.FEED_CURSOR_SECRET = originalSecret;
    }
  });

  it("authenticates a valid cursor and rejects payload tampering", () => {
    const cursor = encodeFeedCursor({
      feed: "new",
      order: FEED_CURSOR_ORDER.NEW,
      source: "mongo",
      phase: "new",
      createdAt: "2026-07-17T00:00:00.000Z",
      _id: "000000000000000000000001",
    });
    const decoded = decodeFeedCursor(cursor, {
      feed: "new",
      orders: [FEED_CURSOR_ORDER.NEW],
      source: "mongo",
    });
    expect(decoded._id).to.equal("000000000000000000000001");

    const [payload, signature] = cursor.split(".");
    const replacement = payload[0] === "A" ? "B" : "A";
    const tampered = `${replacement}${payload.slice(1)}.${signature}`;
    expect(() =>
      decodeFeedCursor(tampered, {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
      }),
    ).to.throw("Invalid or unauthenticated feed cursor");

    expect(() =>
      decodeFeedCursor(`${payload}.${signature}=`, {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
      }),
    ).to.throw("Invalid or unauthenticated feed cursor");
  });

  it("rejects unknown state, oversized strings, and impossible variants", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const signed = (payload: Record<string, unknown>) =>
      encodeAuthenticatedCursor(payload, secret);
    const unknownProperty = signed({
        version: FEED_CURSOR_VERSION,
        feed: "new",
        order: FEED_CURSOR_ORDER.NEW,
        source: "mongo",
        phase: "new",
        expiresAt,
        createdAt: "2026-07-17T00:00:00.000Z",
        _id: "000000000000000000000001",
        seen: ["000000000000000000000001"],
      });
    const impossibleSource = signed({
        version: FEED_CURSOR_VERSION,
        feed: "new",
        order: FEED_CURSOR_ORDER.NEW,
        source: "redis",
        phase: "new",
        expiresAt,
        createdAt: "2026-07-17T00:00:00.000Z",
        _id: "000000000000000000000001",
      });
    const oversizedScope = signed({
        version: FEED_CURSOR_VERSION,
        feed: "for-you",
        order: FEED_CURSOR_ORDER.FOR_YOU,
        source: "mongo",
        expiresAt,
        snapshotId: `${hashFeedCursorScope(["snapshot"])}.1`,
        offset: 0,
        scope: "x".repeat(44),
      });

    expect(() =>
      decodeFeedCursor(unknownProperty, {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
      }),
    ).to.throw("unknown properties");
    expect(() =>
      decodeFeedCursor(impossibleSource, {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
      }),
    ).to.throw("variant");
    expect(() =>
      decodeFeedCursor(oversizedScope, {
        feed: "for-you",
        orders: [FEED_CURSOR_ORDER.FOR_YOU],
      }),
    ).to.throw("scope");
  });

  it("rejects oversized encoded input before decoding", () => {
    expect(() =>
      decodeFeedCursor("x".repeat(MAX_FEED_CURSOR_ENCODED_LENGTH + 1), {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
      }),
    ).to.throw("maximum encoded size");
  });
});
