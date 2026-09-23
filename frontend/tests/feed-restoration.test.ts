import { describe, expect, test } from "vitest";
import { feedIdentities } from "../src/features/feed/feedIdentity.ts";
import {
  FeedRestorationStore,
  formatNewPostsLabel,
} from "../src/features/feed/feedRestoration.ts";

describe("feed restoration", () => {
  test("feed identities isolate feed, subject, filter, and viewer", () => {
    expect(feedIdentities.home("viewer-a")).not.toBe(
      feedIdentities.home("viewer-b"),
    );

    expect(feedIdentities.home("viewer-a")).not.toBe(
      feedIdentities.latest("viewer-a"),
    );

    expect(feedIdentities.community("community-a", "viewer-a")).not.toBe(
      feedIdentities.community("community-b", "viewer-a"),
    );

    expect(feedIdentities.profileMedia("profile-a", "viewer-a")).not.toBe(
      feedIdentities.profileLikes("profile-a", "viewer-a"),
    );

    expect(feedIdentities.search("default", "cats", "viewer-a")).not.toBe(
      feedIdentities.search("default", "dogs", "viewer-a"),
    );

    expect(feedIdentities.search("default", "cats", "viewer-a")).not.toBe(
      feedIdentities.search("handles", "cats", "viewer-a"),
    );
  });

  test("missing identity values cannot collide with the literal none", () => {
    expect(feedIdentities.home()).not.toBe(feedIdentities.home("none"));

    expect(feedIdentities.community(undefined, "viewer-a")).not.toBe(
      feedIdentities.community("none", "viewer-a"),
    );
  });

  test("restoration matches only the originating feed and location", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const otherFeedId = feedIdentities.latest("viewer-a");

    store.captureAnchor({
      feedId,
      postId: "post-a",
      top: 184.5,
      sourceLocationKey: "location-a",
    });

    expect(store.getRestoration(feedId, "location-a")).toEqual({
      feedId,
      postId: "post-a",
      top: 184.5,
      sourceLocationKey: "location-a",
    });

    expect(store.getRestoration(otherFeedId, "location-a")).toBeNull();
    expect(store.getRestoration(feedId, "location-b")).toBeNull();
  });

  test("known post IDs are deduplicated and formatted as exact counts", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-a");
    store.markKnownPostPending(feedId, "post-a");
    store.markKnownPostPending(feedId, "post-b");

    const pending = store.getPending(feedId, "location-a");

    expect(pending).toEqual({
      hasPending: true,
      isUnknown: false,
      count: 2,
    });

    expect(formatNewPostsLabel(pending)).toBe("2 new posts");

    unregister();
  });

  test("unknown pending state never claims an exact count", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-a");
    store.markUnknownPostPending(feedId);

    const pending = store.getPending(feedId, "location-a");

    expect(pending).toEqual({
      hasPending: true,
      isUnknown: true,
      count: 0,
    });

    expect(formatNewPostsLabel(pending)).toBe("New posts");

    unregister();
  });

  test("deleting a pending post updates only truthful known counts", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-a");
    store.markKnownPostPending(feedId, "post-b");

    store.removePendingPost("post-a");

    expect(store.getPending(feedId, "location-a").count).toBe(1);

    store.removePendingPost("post-b");

    expect(store.getPending(feedId, "location-a").hasPending).toBe(false);

    unregister();
  });

  test("a successful refresh can clear pending state for only its feed entry", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-a");

    expect(store.clearPending(feedId, "location-b")).toBe(false);

    expect(store.getPending(feedId, "location-a").hasPending).toBe(true);

    expect(store.clearPending(feedId, "location-a")).toBe(true);

    expect(store.getPending(feedId, "location-a").hasPending).toBe(false);

    unregister();
  });

  test("a refresh cannot clear a newer pending event", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-a");

    const refreshVersion = store.getPendingVersion(feedId, "location-a");

    store.markKnownPostPending(feedId, "post-b");

    expect(store.clearPending(feedId, "location-a", refreshVersion)).toBe(
      false,
    );

    expect(store.getPending(feedId, "location-a").count).toBe(2);

    unregister();
  });

  test("a refresh cannot clear a newer unknown pending event", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    store.markUnknownPostPending(feedId);

    const refreshVersion = store.getPendingVersion(feedId, "location-a");

    store.markUnknownPostPending(feedId);

    expect(store.clearPending(feedId, "location-a", refreshVersion)).toBe(
      false,
    );

    expect(store.getPending(feedId, "location-a")).toEqual({
      hasPending: true,
      isUnknown: true,
      count: 0,
    });

    unregister();
  });

  test("known pending IDs are bounded and degrade to unknown", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const unregister = store.registerSession(feedId, "location-a");

    for (let index = 0; index <= 500; index += 1) {
      store.markKnownPostPending(feedId, `post-${index}`);
    }

    expect(store.getPending(feedId, "location-a")).toEqual({
      hasPending: true,
      isUnknown: true,
      count: 0,
    });

    unregister();
  });

  test("pending survives Strict Mode cleanup for the same feed session", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");
    const locationKey = "location-a";

    const unregisterFirstMount = store.registerSession(feedId, locationKey);

    store.markKnownPostPending(feedId, "post-a");

    unregisterFirstMount();

    expect(store.getPending(feedId, locationKey).hasPending).toBe(false);

    const unregisterSecondMount = store.registerSession(feedId, locationKey);

    expect(store.getPending(feedId, locationKey).count).toBe(1);

    unregisterSecondMount();
  });

  test("registering an unrelated feed prunes abandoned pending state", () => {
    const store = new FeedRestorationStore();
    const oldFeedId = feedIdentities.home("viewer-a");
    const newFeedId = feedIdentities.latest("viewer-a");

    const unregisterOld = store.registerSession(oldFeedId, "location-old");

    store.markKnownPostPending(oldFeedId, "post-a");

    unregisterOld();

    const unregisterNew = store.registerSession(newFeedId, "location-new");

    const unregisterOldAgain = store.registerSession(oldFeedId, "location-old");

    expect(store.getPending(oldFeedId, "location-old").hasPending).toBe(false);

    unregisterOldAgain();
    unregisterNew();
  });

  test("same-feed active and restoring history entries both receive pending IDs", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.home("viewer-a");

    store.captureAnchor({
      feedId,
      postId: "anchor-a",
      top: 100,
      sourceLocationKey: "location-a",
    });

    const unregister = store.registerSession(feedId, "location-c");

    store.markKnownPostPending(feedId, "new-post");

    expect(store.getPending(feedId, "location-a").count).toBe(1);
    expect(store.getPending(feedId, "location-c").count).toBe(1);

    unregister();
  });

  test("a replacement restoration removes abandoned pending state", () => {
    const store = new FeedRestorationStore();
    const oldFeedId = feedIdentities.home("viewer-a");
    const newFeedId = feedIdentities.latest("viewer-a");

    store.captureAnchor({
      feedId: oldFeedId,
      postId: "old-anchor",
      top: 200,
      sourceLocationKey: "location-old",
    });

    store.markKnownPostPending(oldFeedId, "old-pending-post");

    store.captureAnchor({
      feedId: newFeedId,
      postId: "new-anchor",
      top: 120,
      sourceLocationKey: "location-new",
    });

    store.captureAnchor({
      feedId: oldFeedId,
      postId: "another-old-anchor",
      top: 90,
      sourceLocationKey: "location-old",
    });

    expect(store.getPending(oldFeedId, "location-old").hasPending).toBe(false);
  });

  test("a viewer identity change on the same history entry abandons restoration", () => {
    const store = new FeedRestorationStore();
    const signedInFeed = feedIdentities.home("viewer-a");
    const anonymousFeed = feedIdentities.home();

    store.captureAnchor({
      feedId: signedInFeed,
      postId: "post-a",
      top: 100,
      sourceLocationKey: "location-a",
    });

    const unregister = store.registerSession(anonymousFeed, "location-a");

    expect(store.isRestorationFor(signedInFeed, "location-a")).toBe(false);

    unregister();
  });

  test("only an exact restoration match can be consumed", () => {
    const store = new FeedRestorationStore();
    const feedId = feedIdentities.trending("viewer-a");

    store.captureAnchor({
      feedId,
      postId: "post-a",
      top: 300,
      sourceLocationKey: "location-a",
    });

    expect(store.consumeRestoration(feedId, "location-b")).toBe(false);

    expect(store.isRestorationFor(feedId, "location-a")).toBe(true);

    expect(store.consumeRestoration(feedId, "location-a")).toBe(true);

    expect(store.isRestorationFor(feedId, "location-a")).toBe(false);
  });
});
