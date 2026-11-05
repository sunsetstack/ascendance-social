import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { applyLikeCounterUpdate, updatePostCaches } from "../src/hooks/posts/postCache.ts";
import { mapPost } from "../src/lib/mappers.ts";
import type { IPost } from "../src/types/index.ts";

const fixture = (): IPost => ({
  publicId: "post", tags: [], user: { publicId: "author", handle: "author", username: "Author", avatar: "" },
  likes: 0, likesRevision: 0, commentsCount: 0, viewsCount: 0, createdAt: new Date(),
  isLikedByViewer: false, isFavoritedByViewer: false, isRepostedByViewer: false,
});

test("a delayed count cannot undo a later like/unlike/like sequence", () => {
  let post = fixture();
  post = applyLikeCounterUpdate(post, 1, 1);
  post = applyLikeCounterUpdate(post, 0, 2);
  post = applyLikeCounterUpdate(post, 1, 3);
  assert.equal(applyLikeCounterUpdate(post, 0, 2), post);
  assert.equal(post.likes, 1);
  assert.equal(post.likesRevision, 3);
});

test("a fresh HTTP snapshot also rejects an older or unversioned socket count", () => {
  const post = { ...fixture(), likes: 5, likesRevision: 10 };
  assert.equal(applyLikeCounterUpdate(post, 1, 9), post);
  assert.equal(applyLikeCounterUpdate(post, 1), post);
  assert.equal(applyLikeCounterUpdate(post, 1, 10), post);
});

test("unversioned legacy snapshots can adopt a versioned count without losing viewer state", () => {
  const post = { ...fixture(), likesRevision: undefined, isLikedByViewer: true };
  const updated = applyLikeCounterUpdate(post, 3, 1);
  assert.equal(updated.likes, 3);
  assert.equal(updated.isLikedByViewer, true);
  assert.equal(applyLikeCounterUpdate(updated, 0), updated);
});

test("invalid counts and revisions do not corrupt a cached count", () => {
  const post = fixture();
  for (const revision of [-1, NaN, Infinity, 0.5]) assert.equal(applyLikeCounterUpdate(post, 2, revision), post);
  for (const likes of [-1, NaN, Infinity, 0.5]) assert.equal(applyLikeCounterUpdate(post, likes, 1), post);
});

test("repost wrappers and detail caches independently preserve the newest counter", (context) => {
  const client = new QueryClient();
  context.after(() => client.clear());
  const original = { ...fixture(), likes: 4, likesRevision: 7 };
  client.setQueryData(["post", "post"], original);
  client.setQueryData(["forYouFeed"], { pages: [{ data: [{ ...fixture(), publicId: "wrapper", repostOf: original }] }] });
  updatePostCaches(client, "post", (post) => applyLikeCounterUpdate(post, 2, 6));
  assert.equal(client.getQueryData<IPost>(["post", "post"])!.likes, 4);
  const feed = client.getQueryData<{ pages: Array<{ data: IPost[] }> }>(["forYouFeed"])!;
  assert.equal(feed.pages[0]!.data[0]!.repostOf!.likes, 4);
  updatePostCaches(client, "post", (post) => applyLikeCounterUpdate(post, 5, 8));
  assert.equal(client.getQueryData<IPost>(["post", "post"])!.likes, 5);
});

test("mapping retains revisions for posts and their quoted originals", () => {
  const post = fixture();
  const mapped = mapPost({ ...post, likesRevision: 3, repostOf: { ...post, likesRevision: 9 } });
  assert.equal(mapped.likesRevision, 3);
  assert.equal(mapped.repostOf!.likesRevision, 9);
});
