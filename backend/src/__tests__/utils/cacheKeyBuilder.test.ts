import { expect } from "chai";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

describe("CacheKeyBuilder", () => {
  it("does not mutate caller IDs when building a batch key", () => {
    const userIds = ["charlie", "alice", "bravo"];

    const key = CacheKeyBuilder.getUserBatchKey(userIds);

    expect(key).to.equal("user_batch:alice,bravo,charlie");
    expect(userIds).to.deep.equal(["charlie", "alice", "bravo"]);
  });
});
