import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import mongoose, { Types } from "mongoose";
import Post from "@/models/post.model";
import { PostCountersRepository } from "@/repositories/read/PostCountersRepository";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import type {
  PostCounters,
  PostCounterSnapshot,
} from "@/application/ports/post-counters";
import type { FeedPost } from "@/types";

const uri = process.env.INTEGRATION_MONGODB_URI;
const databaseName = `ascendance_feed_query_budget_${randomUUID().replaceAll("-", "")}`;

(uri ? describe : describe.skip)("Feed counter query budget", function () {
  this.timeout(30_000);
  let page: FeedPost[];
  let counterQueries = 0;
  let repository: PostCountersRepository;
  let enrichment: FeedEnrichmentService;
  const userLookup = { findMany: async () => [] };

  before(async () => {
    if (!uri!.startsWith("mongodb://127.0.0.1:"))
      throw new Error("Requires isolated local MongoDB");
    await mongoose.connect(uri!, {
      dbName: databaseName,
      monitorCommands: true,
    });
    await Post.init();
    const author = new Types.ObjectId();
    await Post.insertMany(
      Array.from({ length: 20 }, (_, index) => ({
        publicId: randomUUID(),
        user: author,
        body: `Post ${index}`,
        likesCount: index,
        likesRevision: index,
        commentsCount: index + 1,
        viewsCount: index + 2,
        author: {
          _id: author,
          publicId: randomUUID(),
          handle: "author",
          username: "Author",
        },
      })),
    );
    page = normalizeFeedPosts(await Post.find().lean().exec());
    repository = new PostCountersRepository(Post);
    enrichment = new FeedEnrichmentService(userLookup, repository);
    mongoose.connection.getClient().on("commandStarted", (event) => {
      if (event.commandName === "find" && event.command.find === "posts")
        counterQueries++;
    });
  });

  after(async () => {
    if (mongoose.connection.name === databaseName)
      await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("preserves freshly loaded counts and revisions without a second Mongo read", async () => {
    counterQueries = 0;
    expect(await enrichment.enrichFeedWithCurrentData(page)).to.deep.equal(
      page,
    );
    expect(counterQueries).to.equal(0);
  });

  it("refreshes cached counts, including decreases, without retaining stale results", async () => {
    const id = page[0].publicId;
    await Post.updateOne(
      { publicId: id },
      {
        $set: {
          likesCount: 9,
          likesRevision: 30,
          commentsCount: 7,
          viewsCount: 40,
        },
      },
    );
    counterQueries = 0;
    const first = await enrichment.enrichFeedWithCurrentData(page, {
      refreshCounters: true,
    });
    expect(first[0]).to.include({
      likes: 9,
      likesRevision: 30,
      commentsCount: 7,
      viewsCount: 40,
    });
    await Post.updateOne(
      { publicId: id },
      { $set: { likesCount: 0, likesRevision: 31, commentsCount: 0 } },
    );
    const second = await enrichment.enrichFeedWithCurrentData(page, {
      refreshCounters: true,
    });
    expect(second[0]).to.include({
      likes: 0,
      likesRevision: 31,
      commentsCount: 0,
      viewsCount: 40,
    });
    expect(second.map((post) => post.publicId)).to.deep.equal(
      page.map((post) => post.publicId),
    );
    expect(counterQueries).to.equal(2);
  });

  it("refreshes repost originals in the same query as their wrappers", async () => {
    const original = page[1];
    const wrapper: FeedPost = {
      ...page[0],
      repostOf: {
        publicId: original.publicId,
        user: original.user,
        likes: -1,
        likesRevision: 0,
        commentsCount: -1,
      },
    };
    counterQueries = 0;
    const [refreshed] = await enrichment.enrichFeedWithCurrentData([wrapper], {
      refreshCounters: true,
    });
    expect(refreshed.repostOf).to.include({
      likes: original.likes,
      likesRevision: original.likesRevision,
      commentsCount: original.commentsCount,
    });
    expect(counterQueries).to.equal(1);
  });

  it("measures enrichment query counts and latency for 200 calls at concurrency 20", async () => {
    page = normalizeFeedPosts(await Post.find().lean().exec());
    // The baseline reproduces the former one-query-per-enrichment behavior.
    const baselineCounters: PostCounters = {
      async getPostMetadata(ids): Promise<(PostCounterSnapshot | null)[]> {
        const posts = await Post.find({ publicId: { $in: ids } })
          .select(
            "publicId likesCount likesRevision commentsCount viewsCount -_id",
          )
          .lean()
          .exec();
        const byId = new Map<string, PostCounterSnapshot>(
          posts.map((post) => [
            post.publicId,
            {
              likes: post.likesCount ?? 0,
              likesRevision: post.likesRevision ?? 0,
              commentsCount: post.commentsCount ?? 0,
              viewsCount: post.viewsCount ?? 0,
            },
          ]),
        );
        return ids.map((id) => byId.get(id) ?? null);
      },
    };
    const baseline = new FeedEnrichmentService(userLookup, baselineCounters);
    expect(await enrichment.enrichFeedWithCurrentData(page)).to.deep.equal(
      await baseline.enrichFeedWithCurrentData(page, { refreshCounters: true }),
    );
    const measure = async (
      service: FeedEnrichmentService,
      refreshCounters: boolean,
    ) => {
      const durations: number[] = [];
      counterQueries = 0;
      const started = performance.now();
      for (let wave = 0; wave < 10; wave++) {
        await Promise.all(
          Array.from({ length: 20 }, async () => {
            const callStarted = performance.now();
            const result = await service.enrichFeedWithCurrentData(page, {
              refreshCounters,
            });
            expect(result).to.have.length(20);
            durations.push(performance.now() - callStarted);
          }),
        );
      }
      durations.sort((left, right) => left - right);
      return {
        queries: counterQueries,
        p50Ms: durations[99],
        p95Ms: durations[189],
        elapsedMs: performance.now() - started,
      };
    };
    await measure(baseline, true);
    await measure(enrichment, true);
    const before = await measure(baseline, true);
    const fresh = await measure(enrichment, false);
    const cached = await measure(enrichment, true);
    expect(before.queries).to.equal(200);
    expect(fresh.queries).to.equal(0);
    expect(cached.queries).to.equal(10);
    console.log(
      "[feed-query-budget]",
      JSON.stringify({ calls: 200, concurrency: 20, before, fresh, cached }),
    );
  });
});
