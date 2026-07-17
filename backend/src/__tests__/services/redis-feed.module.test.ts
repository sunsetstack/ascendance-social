import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { encodeFeedCursor, FEED_CURSOR_ORDER } from "@/utils/feedCursor";

describe("RedisFeedModule", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("continues scanning additional score batches when the first batch is fully filtered out by the cursor", async () => {
    const buildBatch = (start: number, end: number) =>
      Array.from({ length: start - end + 1 }, (_, index) => ({
        score: 10,
        value: `post-${String(start - index).padStart(3, "0")}`,
      }));

    const zRangeWithScores = sinon.stub();
    zRangeWithScores.onFirstCall().resolves(buildBatch(60, 21));
    zRangeWithScores.onSecondCall().resolves(buildBatch(20, 1));

    const module = new RedisFeedModule({
      zRangeWithScores,
    } as any);

    const result = await module.getTrendingFeedWithCursor(
      20,
      encodeFeedCursor({
        feed: "trending",
        order: FEED_CURSOR_ORDER.TRENDING,
        source: "redis",
        phase: "trending",
        trendScore: 10,
        _id: "post-021",
      }),
    );

    expect(result.ids).to.deep.equal(buildBatch(20, 1).map((item) => item.value));
    expect(result.hasMore).to.equal(false);
    expect(zRangeWithScores.calledTwice).to.equal(true);
    expect(zRangeWithScores.secondCall.args[3]).to.deep.equal({
      BY: "SCORE",
      REV: true,
      LIMIT: { offset: 40, count: 40 },
    });
  });

  it("adds posts to many feeds in de-duped Redis batches", async () => {
    const pipelines: Array<{
      zAdd: sinon.SinonSpy;
      expire: sinon.SinonSpy;
      exec: sinon.SinonStub;
    }> = [];

    const client = {
      multi: sinon.stub().callsFake(() => {
        const pipeline = {
          zAdd: sinon.spy(),
          expire: sinon.spy(),
          exec: sinon.stub().resolves([]),
        };
        pipelines.push(pipeline);
        return pipeline;
      }),
    };

    const module = new RedisFeedModule(client as any);
    const userIds = [
      ...Array.from({ length: 1001 }, (_, index) => `user-${index}`),
      "user-0",
    ];

    await module.addToFeedsBatch(userIds, "post-1", 123, "for_you");

    expect(client.multi.callCount).to.equal(3);
    expect(pipelines.reduce((total, pipeline) => total + pipeline.zAdd.callCount, 0)).to.equal(1001);
    expect(pipelines.reduce((total, pipeline) => total + pipeline.expire.callCount, 0)).to.equal(1001);
    expect(pipelines[0].zAdd.firstCall.args).to.deep.equal([
      CacheKeyBuilder.getRedisFeedKey("for_you", "user-0"),
      { score: 123, value: "post-1" },
    ]);
  });

  it("removes posts from many feeds in de-duped Redis batches", async () => {
    const pipelines: Array<{
      zRem: sinon.SinonSpy;
      exec: sinon.SinonStub;
    }> = [];

    const client = {
      multi: sinon.stub().callsFake(() => {
        const pipeline = {
          zRem: sinon.spy(),
          exec: sinon.stub().resolves([]),
        };
        pipelines.push(pipeline);
        return pipeline;
      }),
    };

    const module = new RedisFeedModule(client as any);
    const userIds = [
      ...Array.from({ length: 1001 }, (_, index) => `user-${index}`),
      "user-0",
    ];

    await module.removeFromFeedsBatch(userIds, "post-1", "for_you");

    expect(client.multi.callCount).to.equal(3);
    expect(pipelines.reduce((total, pipeline) => total + pipeline.zRem.callCount, 0)).to.equal(1001);
    expect(pipelines[0].zRem.firstCall.args).to.deep.equal([
      CacheKeyBuilder.getRedisFeedKey("for_you", "user-0"),
      "post-1",
    ]);
  });

  it("removes all deleted account posts from each affected feed", async () => {
    const pipeline = {
      zRem: sinon.spy(),
      exec: sinon.stub().resolves([]),
    };
    const client = { multi: sinon.stub().returns(pipeline) };
    const module = new RedisFeedModule(client as any);

    await module.removePostsFromFeedsBatch(
      ["departed", "follower", "follower"],
      ["post-1", "post-2", "post-1"],
      "for_you",
    );

    expect(pipeline.zRem.callCount).to.equal(2);
    expect(pipeline.zRem.firstCall.args).to.deep.equal([
      CacheKeyBuilder.getRedisFeedKey("for_you", "departed"),
      ["post-1", "post-2"],
    ]);
    expect(pipeline.zRem.secondCall.args).to.deep.equal([
      CacheKeyBuilder.getRedisFeedKey("for_you", "follower"),
      ["post-1", "post-2"],
    ]);
  });
});
