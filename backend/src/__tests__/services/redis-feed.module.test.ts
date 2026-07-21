import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

describe("RedisFeedModule", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("continues from an immutable Redis snapshot instead of rescanning a changed ZSET", async () => {
    const buildBatch = (start: number, end: number) =>
      Array.from({ length: start - end + 1 }, (_, index) => ({
        score: 10,
        value: `post-${String(start - index).padStart(3, "0")}`,
      }));

    const store = new Map<string, string>();
    const zRangeWithScores = sinon.stub().resolves(buildBatch(60, 1));
    const get = sinon.stub().callsFake(async (key: string) => store.get(key) ?? null);
    const set = sinon
      .stub()
      .callsFake(async (key: string, value: string) => {
        if (!store.has(key)) store.set(key, value);
        return "OK";
      });
    const expire = sinon.stub().resolves(true);

    const module = new RedisFeedModule({
      zRangeWithScores,
      get,
      set,
      expire,
    } as any);

    const first = await module.getTrendingFeedWithCursor(20);
    zRangeWithScores.resolves([]);
    const second = await module.getTrendingFeedWithCursor(20, first.nextCursor);

    expect(first.ids).to.deep.equal(buildBatch(60, 41).map((item) => item.value));
    expect(second.ids).to.deep.equal(buildBatch(40, 21).map((item) => item.value));
    expect(first.hasMore).to.equal(true);
    expect(second.hasMore).to.equal(true);
    expect(zRangeWithScores.calledOnce).to.equal(true);
    expect(zRangeWithScores.firstCall.args).to.deep.equal([
      "trending:posts",
      0,
      5_000,
      { REV: true },
    ]);
    expect(expire.notCalled).to.equal(true);
  });

  it("coalesces concurrent snapshot builds for the same generation", async () => {
    const store = new Map<string, string>();
    const get = sinon.stub().callsFake(async (key: string) => store.get(key) ?? null);
    const set = sinon.stub().callsFake(async (key: string, value: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    });
    let releaseBuild!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const build = sinon.stub().callsFake(async () => {
      await buildStarted;
      return {
        version: 1,
        feed: "trending" as const,
        order: "trending-score-id-desc-v1" as const,
        source: "redis" as const,
        entries: [],
      };
    });
    const metrics = {
      recordFeedCursorSnapshotAccess: sinon.spy(),
      recordFeedCursorSnapshotCreation: sinon.spy(),
      recordFeedCursorSnapshotBuildCollision: sinon.spy(),
    };
    const module = new RedisFeedModule({ get, set } as any, metrics as any);

    const first = module.getOrCreateFeedCursorSnapshot("same-feed", build);
    await Promise.resolve();
    const second = module.getOrCreateFeedCursorSnapshot("same-feed", build);
    releaseBuild();

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(build.calledOnce).to.equal(true);
    expect(firstSnapshot).to.deep.equal(secondSnapshot);
    expect(metrics.recordFeedCursorSnapshotBuildCollision.calledOnce).to.equal(
      true,
    );
    expect(metrics.recordFeedCursorSnapshotCreation.calledOnce).to.equal(true);
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
