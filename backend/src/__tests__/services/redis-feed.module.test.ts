import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import { FEED_CURSOR_ORDER, hashFeedCursorScope, type FeedCursorSnapshot } from "@/utils/feedCursor";

describe("RedisFeedModule", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("pins exact rank components with the persisted score across changed build inputs", async () => {
    const store = new Map<string, string>();
    const module = new RedisFeedModule({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string) => { store.set(key, value); return "OK"; },
    } as never);
    const rankBreakdown = { freshness: 0.28765432109876, popularity: 0.02, topic: 0.4, format: 0.1 };
    const snapshot: FeedCursorSnapshot = {
      version: 1, feed: "personalized", order: FEED_CURSOR_ORDER.PERSONALIZED_RANKED, source: "mongo",
      scope: hashFeedCursorScope(["viewer"]), entries: [{ _id: "post-1", publicId: "public-1", visibleIdentityId: "post-1",
        score: Object.values(rankBreakdown).reduce((sum, value) => sum + value, 0), rankBreakdown, reason: "learned:crypto",
        formatMix: { format: "image", share: 0.7334399194970058, basePosition: 37 } }],
    };
    const original = JSON.parse(JSON.stringify(snapshot)) as FeedCursorSnapshot;
    const first = await module.getOrCreateFeedCursorSnapshot("pinned-rank", async () => snapshot);
    snapshot.entries[0].rankBreakdown!.topic = 0;
    snapshot.entries[0].formatMix!.share = 0;
    const rebuild = sinon.stub().resolves(snapshot);
    const second = await module.getOrCreateFeedCursorSnapshot("pinned-rank", rebuild);
    expect(first.snapshot).to.deep.equal(original);
    expect(second).to.deep.equal(first);
    expect(rebuild.notCalled).to.equal(true);
  });

  it("rejects corrupt or mismatched rank components without accepting a misleading score explanation", async () => {
    const entry = { _id: "post-1", publicId: "public-1", visibleIdentityId: "post-1", score: 0.6 };
    const id = `${hashFeedCursorScope(["rank-validation"])}.1`;
    const get = sinon.stub();
    const module = new RedisFeedModule({ get } as never);
    for (const rankBreakdown of [null, { freshness: 0.3, popularity: 0.1, topic: 0.1 },
      { freshness: 0.3, popularity: 0.1, topic: 0.1, format: -0.1 },
      { freshness: 0.3, popularity: 0.1, topic: 0.1, format: 0.2 },
      { freshness: 0.3, popularity: 0.1, topic: 0.1, format: "0.1" }]) {
      get.resolves(JSON.stringify({ version: 1, feed: "personalized", order: FEED_CURSOR_ORDER.PERSONALIZED_RANKED,
        source: "mongo", scope: hashFeedCursorScope(["viewer"]), entries: [{ ...entry, rankBreakdown }] }));
      expect(await module.getFeedCursorSnapshot(id)).to.equal(null);
    }
    const legacy: FeedCursorSnapshot = { version: 1, feed: "personalized", order: FEED_CURSOR_ORDER.PERSONALIZED_RANKED,
      source: "mongo", scope: hashFeedCursorScope(["viewer"]), entries: [entry] };
    get.resolves(JSON.stringify(legacy));
    expect(await module.getFeedCursorSnapshot(id)).to.deep.equal(legacy);
  });

  it("rejects invalid format allocation metadata while accepting snapshots without it", async () => {
    const entry = { _id: "post-1", publicId: "public-1", visibleIdentityId: "post-1", score: 0.6 };
    const id = `${hashFeedCursorScope(["format-validation"])}.1`;
    const get = sinon.stub();
    const module = new RedisFeedModule({ get } as never);
    const snapshot = { version: 1, feed: "personalized", order: FEED_CURSOR_ORDER.PERSONALIZED_RANKED,
      source: "mongo", scope: hashFeedCursorScope(["viewer"]), entries: [entry] };
    for (const formatMix of [null, { format: "video", share: 0.5, basePosition: 0 },
      { format: "image", share: 0, basePosition: 0 }, { format: "image", share: 1.1, basePosition: 0 },
      { format: "image", share: "0.5", basePosition: 0 }, { format: "image", share: 0.5, basePosition: -1 },
      { format: "image", share: 0.5, basePosition: 0.5 }, { format: "image", share: 0.5 },
      { format: "image", share: 0.5, basePosition: 0, extra: true }]) {
      get.resolves(JSON.stringify({ ...snapshot, entries: [{ ...entry, formatMix }] }));
      expect(await module.getFeedCursorSnapshot(id)).to.equal(null);
    }
    get.resolves(JSON.stringify(snapshot));
    expect(await module.getFeedCursorSnapshot(id)).to.deep.equal(snapshot);
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
});
