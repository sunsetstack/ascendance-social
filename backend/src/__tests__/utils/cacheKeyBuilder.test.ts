import { expect } from "chai";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

describe("CacheKeyBuilder", () => {
  it("does not mutate caller IDs when building a batch key", () => {
    const userIds = ["charlie", "alice", "bravo"];

    const key = CacheKeyBuilder.getUserBatchKey(userIds);

    expect(key).to.equal("user_batch:alice,bravo,charlie");
    expect(userIds).to.deep.equal(["charlie", "alice", "bravo"]);
  });

  it("matches versioned personalized cursor keys in fallback invalidation", () => {
    const key = CacheKeyBuilder.getPersonalizedCursorFeedKey(
      "viewer",
      "cursor",
      20,
    );
    const pattern = CacheKeyBuilder.getCoreFeedKeyPattern("viewer");

    expect(pattern).to.equal("core_feed:*:viewer:*");
    expect(key).to.match(
      /^core_feed:v2:personalized-created-at-id-desc-v1:viewer:cursor:[A-Za-z0-9_-]{43}:limit:20$/,
    );
  });
});
