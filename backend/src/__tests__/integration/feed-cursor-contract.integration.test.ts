import "reflect-metadata";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import express, {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import sinon from "sinon";

import { QueryBus } from "@/application/common/buses/query.bus";
import { CommandBus } from "@/application/common/buses/command.bus";
import { FeedProfile, FeedSignal } from "@/models/feed-profile.model";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import { GetNewFeedQuery } from "@/application/queries/feed/getNewFeed/getNewFeed.query";
import { GetNewFeedQueryHandler } from "@/application/queries/feed/getNewFeed/getNewFeed.handler";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import { GetTrendingFeedQuery } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.query";
import { GetTrendingFeedQueryHandler } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.handler";
import { GetPostsQuery } from "@/application/queries/post/getPosts/getPosts.query";
import { GetPostsQueryHandler } from "@/application/queries/post/getPosts/getPosts.handler";
import { FeedController } from "@/controllers/feed.controller";
import { PostController } from "@/controllers/post.controller";
import { MetricsService } from "@/metrics/metrics.service";
import Post from "@/models/post.model";
import { FeedReadDao } from "@/repositories/read/FeedReadDao";
import { PostReadRepository } from "@/repositories/read/PostReadRepository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { TagRepository } from "@/repositories/tag.repository";
import { FeedRoutes } from "@/routes/feed.routes";
import { PostRoutes } from "@/routes/post.routes";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { DTOService } from "@/services/dto.service";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { RedisService } from "@/services/redis.service";
import { RedisFeedCache } from "@/services/redis/capabilities/redis-feed-cache";
import { RedisUserLookup } from "@/services/redis/capabilities/redis-user-lookup";
import type { CoreFeed, FeedPost, PostDTO } from "@/types";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { encodeAuthenticatedCursor } from "@/utils/cursorCodec";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_ORDER,
  FEED_CURSOR_VERSION,
  hashFeedCursorScope,
  MAX_FEED_CURSOR_ENCODED_LENGTH,
} from "@/utils/feedCursor";
import { AppError } from "@/utils/errors";
import { NewFeedWarmCacheWorker } from "@/workers/_impl/newFeedWarmCache.worker.impl";
import { createTrendingWorker } from "@/__tests__/workers/trending-worker.test-helper";

const mongoUri = process.env.INTEGRATION_MONGODB_URI;
const redisUrl = process.env.REDIS_URL;
const feedCursorTestSecret =
  process.env.FEED_CURSOR_SECRET ??
  process.env.JWT_SECRET ??
  "ascendance-feed-cursor-test-secret-v2";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const fixedCreatedAt = new Date(Date.now() - ONE_DAY_MS);
const viewerPublicId = asUserPublicId("feed-contract-viewer");
const viewerInternalId = objectIdFor(90_000);
const followedAuthorId = objectIdFor(90_001);
const otherAuthorId = objectIdFor(90_002);

type CursorPageResult = {
  data: Array<{ publicId: string; repostOf?: { publicId?: string } | null }>;
  hasMore?: boolean;
  nextCursor?: string;
};

type PageObservation = {
  ids: string[];
  hasMore: boolean;
  nextCursor: "present" | "absent";
  dataSource: string;
  cursorSource: string;
};

type JourneyObservation = {
  pages: PageObservation[];
  identities: string[];
  termination: "exhausted" | "has-more-without-cursor" | "max-pages";
};

type SeedPost = {
  order: number;
  publicId?: string;
  createdAt?: Date;
  likes?: number;
  comments?: number;
  authorId?: Types.ObjectId;
  authorPublicId?: string;
  type?: "original" | "repost";
  repostOfOrder?: number;
};

function objectIdFor(order: number): Types.ObjectId {
  return new Types.ObjectId(order.toString(16).padStart(24, "0"));
}

function publicIdFor(order: number): string {
  return `feed-post-${String(order).padStart(3, "0")}`;
}

function descendingPublicIds(from: number, to = 1): string[] {
  const ids: string[] = [];
  for (let order = from; order >= to; order -= 1) {
    ids.push(publicIdFor(order));
  }
  return ids;
}

function toPostDocument(spec: SeedPost): Record<string, unknown> {
  const authorId = spec.authorId ?? otherAuthorId;
  const authorPublicId =
    spec.authorPublicId ??
    (authorId.equals(followedAuthorId)
      ? "feed-followed-author"
      : "feed-other-author");
  const createdAt = spec.createdAt ?? fixedCreatedAt;

  return {
    _id: objectIdFor(spec.order),
    publicId: spec.publicId ?? publicIdFor(spec.order),
    user: authorId,
    author: {
      _id: authorId,
      publicId: authorPublicId,
      handle: authorPublicId,
      username: authorPublicId,
      avatarUrl: "",
      displayName: authorPublicId,
    },
    body: spec.type === "repost" ? "" : `post ${spec.order}`,
    tags: [],
    likesCount: spec.likes ?? 0,
    commentsCount: spec.comments ?? 0,
    viewsCount: 0,
    repostCount: 0,
    type: spec.type ?? "original",
    status: "active",
    repostOf:
      spec.repostOfOrder === undefined ? null : objectIdFor(spec.repostOfOrder),
    createdAt,
    updatedAt: createdAt,
  };
}

async function seedPosts(specs: SeedPost[]): Promise<void> {
  if (specs.length === 0) return;
  await mongoose.connection
    .db!.collection("posts")
    .insertMany(specs.map(toPostDocument));
}

function observePage(
  result: CursorPageResult,
  dataSource: string,
  cursorSource = dataSource,
): PageObservation {
  const nextCursor = result.nextCursor ? "present" : "absent";
  return {
    ids: result.data.map((post) => post.publicId),
    hasMore: result.hasMore === true,
    nextCursor,
    dataSource,
    cursorSource: nextCursor === "present" ? cursorSource : "none",
  };
}

async function walkCursor(
  fetchPage: (
    cursor: string | undefined,
    page: number,
  ) => Promise<{
    result: CursorPageResult;
    dataSource: string;
    cursorSource?: string;
  }>,
  maxPages = 20,
): Promise<JourneyObservation> {
  const pages: PageObservation[] = [];
  let cursor: string | undefined;

  for (let page = 1; page <= maxPages; page += 1) {
    const fetched = await fetchPage(cursor, page);
    pages.push(
      observePage(
        fetched.result,
        fetched.dataSource,
        fetched.cursorSource ?? fetched.dataSource,
      ),
    );

    if (!fetched.result.hasMore) {
      return {
        pages,
        identities: pages.flatMap((entry) => entry.ids),
        termination: "exhausted",
      };
    }

    if (!fetched.result.nextCursor) {
      return {
        pages,
        identities: pages.flatMap((entry) => entry.ids),
        termination: "has-more-without-cursor",
      };
    }

    cursor = fetched.result.nextCursor;
  }

  return {
    pages,
    identities: pages.flatMap((entry) => entry.ids),
    termination: "max-pages",
  };
}

function expectedJourney(
  ids: string[],
  limit: number,
  dataSource: string,
  cursorSource = dataSource,
): JourneyObservation {
  const pages: PageObservation[] = [];
  for (let index = 0; index < ids.length; index += limit) {
    const pageIds = ids.slice(index, index + limit);
    const hasMore = index + limit < ids.length;
    pages.push({
      ids: pageIds,
      hasMore,
      nextCursor: hasMore ? "present" : "absent",
      dataSource,
      cursorSource: hasMore ? cursorSource : "none",
    });
  }
  return { pages, identities: ids, termination: "exhausted" };
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function withDiagnostics(
  journey: JourneyObservation,
  expectedIds: string[],
): JourneyObservation & {
  repeated: string[];
  missing: string[];
  unexpected: string[];
} {
  const actualSet = new Set(journey.identities);
  const expectedSet = new Set(expectedIds);
  return {
    ...journey,
    repeated: duplicateIds(journey.identities),
    missing: expectedIds.filter((id) => !actualSet.has(id)),
    unexpected: journey.identities.filter((id) => !expectedSet.has(id)),
  };
}

function assertContract(
  name: string,
  invariant: string,
  expected: unknown,
  observed: unknown,
): void {
  const detail = [
    `[${name}] ${invariant}`,
    `expected=${JSON.stringify(expected)}`,
    `observed=${JSON.stringify(observed)}`,
  ].join("\n");
  expect(observed, detail).to.deep.equal(expected);
}

function appErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: String(error) });
}

describe("Feed cursor/source contract integration", function () {
  this.timeout(30_000);

  let connectedHere = false;
  let redisService: RedisService;
  let feedReadDao: FeedReadDao;
  let postReadRepository: PostReadRepository;
  let feedEnrichmentService: FeedEnrichmentService;
  let feedReadService: FeedReadService;
  let personalizedHandler: GetPersonalizedFeedQueryHandler;
  let forYouHandler: GetForYouFeedQueryHandler;
  let trendingHandler: GetTrendingFeedQueryHandler;
  let newHandler: GetNewFeedQueryHandler;

  const userReadRepository = {
    findByPublicId: async (publicId: string) =>
      publicId === viewerPublicId
        ? {
            _id: viewerInternalId,
            id: viewerInternalId.toHexString(),
            publicId: viewerPublicId,
          }
        : null,
    findUsersByPublicIds: async (publicIds: string[]) =>
      publicIds.map((publicId) => ({
        publicId,
        handle: publicId,
        username: publicId,
        avatar: "",
      })),
  };

  const dtoService = {
    toPostDTO: (post: FeedPost) => post as unknown as PostDTO,
  };

  before(async () => {
    if (
      !mongoUri ||
      !mongoUri.includes("127.0.0.1") ||
      !mongoUri.includes("ascendance_integration")
    ) {
      throw new Error(
        "Feed cursor integration tests require the isolated local ascendance_integration replica set. Run `npm run test-integration` from the repository root.",
      );
    }
    if (!redisUrl || !redisUrl.includes("127.0.0.1")) {
      throw new Error(
        "Feed cursor integration tests require the isolated local Redis service. Run `npm run test-integration` from the repository root.",
      );
    }

    if (mongoose.connection.readyState === 0) {
      connectedHere = true;
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
      });
    }

    redisService = new RedisService(new MetricsService());
    const redisConnected = await redisService.waitForConnection(5_000);
    if (!redisConnected) {
      throw new Error("The isolated feed-test Redis service did not connect");
    }

    feedReadDao = new FeedReadDao(
      Post,
      {
        findByTags: async () => [],
      } as unknown as TagRepository,
      redisService,
    );
    postReadRepository = new PostReadRepository(Post);
    const userLookup = new RedisUserLookup(
      redisService,
      userReadRepository as unknown as IUserReadRepository,
    );
    const feedCache = new RedisFeedCache(redisService);
    feedEnrichmentService = new FeedEnrichmentService(userLookup, feedCache);
    feedReadService = new FeedReadService(
      feedReadDao,
      redisService,
      dtoService as unknown as DTOService,
      feedEnrichmentService,
    );
    forYouHandler = new GetForYouFeedQueryHandler(
      feedReadDao,
      userReadRepository as unknown as IUserReadRepository,
      new FeedPreferenceRepository(FeedProfile, FeedSignal),
      feedEnrichmentService,
    );
    personalizedHandler = new GetPersonalizedFeedQueryHandler(forYouHandler);
    trendingHandler = new GetTrendingFeedQueryHandler(
      feedReadDao,
      postReadRepository,
      redisService,
      feedEnrichmentService,
    );
    newHandler = new GetNewFeedQueryHandler(feedReadService);
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection("posts").deleteMany({});
    await redisService.clientInstance.flushDb();
  });

  afterEach(() => {
    sinon.restore();
  });

  after(async () => {
    await mongoose.connection.db?.collection("posts").deleteMany({});
    if (redisService) {
      await redisService.clientInstance.flushDb().catch(() => undefined);
      await redisService.unsubscribeAll().catch(() => undefined);
      await redisService.clientInstance.disconnect().catch(() => undefined);
    }
    if (connectedHere) await mongoose.disconnect();
  });

  function buildFeedApp(): express.Express {
    const queryBus = new QueryBus();
    queryBus.register(GetPersonalizedFeedQuery, personalizedHandler);
    queryBus.register(GetForYouFeedQuery, forYouHandler);
    queryBus.register(GetTrendingFeedQuery, trendingHandler);
    queryBus.register(GetNewFeedQuery, newHandler);

    const attachViewer: RequestHandler = (req, _res, next) => {
      req.decodedUser = {
        publicId: viewerPublicId,
        email: "feed-contract@example.test",
        handle: "feed-contract-viewer",
        username: "Feed Contract Viewer",
        isAdmin: false,
      };
      next();
    };
    const routes = new FeedRoutes(new FeedController(queryBus, new CommandBus()), {
      required: () => attachViewer,
      optional: () => attachViewer,
    } as unknown as AuthMiddlewareService);
    const app = express();
    app.use("/api/feed", routes.getRouter());
    app.use(appErrorMiddleware);
    return app;
  }

  function buildLegacyPostsApp(): express.Express {
    const queryBus = new QueryBus();
    queryBus.register(GetPostsQuery, new GetPostsQueryHandler(feedReadService));
    const controller = new PostController({} as CommandBus, queryBus);
    const passThrough: RequestHandler = (_req, _res, next) => next();
    const routes = new PostRoutes(controller, {
      required: () => passThrough,
      optional: () => passThrough,
    } as unknown as AuthMiddlewareService);
    const app = express();
    app.use("/api/posts", routes.getRouter());
    app.use(appErrorMiddleware);
    return app;
  }

  it("keeps equal-createdAt New posts complete and unique for more than ten pages", async () => {
    await seedPosts(
      Array.from({ length: 31 }, (_, index) => ({ order: index + 1 })),
    );
    const expectedIds = descendingPublicIds(31);
    const observed = await walkCursor(async (cursor) => ({
      result: await feedReadDao.getNewFeedWithCursor({ limit: 3, cursor }),
      dataSource: "mongo:new",
    }));
    const expected = expectedJourney(expectedIds, 3, "mongo:new");

    assertContract(
      "F02 equal timestamps and ten-page traversal",
      "The (createdAt,_id) cursor must return every snapshot identity exactly once and terminate after page 11.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("keeps a New cursor stable when a newer post is inserted and its anchor is deleted", async () => {
    await seedPosts(
      Array.from({ length: 8 }, (_, index) => ({ order: index + 1 })),
    );

    const first = await feedReadDao.getNewFeedWithCursor({ limit: 3 });
    await Post.deleteOne({ _id: objectIdFor(6) });
    await seedPosts([{ order: 9 }]);

    const remaining = await walkCursor(async (cursor, page) => {
      if (page === 1) {
        return {
          result: await feedReadDao.getNewFeedWithCursor({
            limit: 3,
            cursor: first.nextCursor,
          }),
          dataSource: "mongo:new",
        };
      }
      return {
        result: await feedReadDao.getNewFeedWithCursor({ limit: 3, cursor }),
        dataSource: "mongo:new",
      };
    });
    const observed: JourneyObservation = {
      pages: [observePage(first, "mongo:new"), ...remaining.pages],
      identities: [
        ...first.data.map((post) => post.publicId),
        ...remaining.identities,
      ],
      termination: remaining.termination,
    };
    const expectedIds = [
      publicIdFor(8),
      publicIdFor(7),
      publicIdFor(6),
      publicIdFor(5),
      publicIdFor(4),
      publicIdFor(3),
      publicIdFor(2),
      publicIdFor(1),
    ];
    const expected = expectedJourney(expectedIds, 3, "mongo:new");

    assertContract(
      "F02 insert/delete churn",
      "Newer inserts must not enter an older traversal, and deleting the encoded anchor must not repeat or hide any still-live snapshot post.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("uses deterministic _id tie-breakers for equal Mongo rank and trend scores", async () => {
    await seedPosts(
      Array.from({ length: 7 }, (_, index) => ({
        order: index + 1,
        likes: 5,
        comments: 5,
      })),
    );
    const expectedIds = descendingPublicIds(7);
    const ranked = await walkCursor(async (cursor) => ({
      result: await feedReadDao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: viewerPublicId, viewerMongoId: String(viewerInternalId) }, {
        limit: 2,
        cursor,
      }),
      dataSource: "mongo:ranked",
    }));
    const trending = await walkCursor(async (cursor) => ({
      result: await feedReadDao.getTrendingFeedWithCursor({
        limit: 2,
        cursor,
        minLikes: 0,
        timeWindowDays: 30,
        weights: { recency: 0, popularity: 1, comments: 0 },
      }),
      dataSource: "mongo:trending",
    }));
    const observed = {
      ranked: withDiagnostics(ranked, expectedIds),
      trending: withDiagnostics(trending, expectedIds),
    };
    const expected = {
      ranked: withDiagnostics(
        expectedJourney(expectedIds, 2, "mongo:ranked"),
        expectedIds,
      ),
      trending: withDiagnostics(
        expectedJourney(expectedIds, 2, "mongo:trending"),
        expectedIds,
      ),
    };

    assertContract(
      "F04 equal score tie-breakers",
      "With score mutation disabled, equal-score pagination must be total and stable by _id.",
      expected,
      observed,
    );
  });

  it("does not silently lose a ranked post whose score rises between page requests", async () => {
    await seedPosts(
      Array.from({ length: 6 }, (_, index) => ({
        order: index + 1,
        likes: index + 1,
      })),
    );
    const expectedIds = descendingPublicIds(6);
    const first = await feedReadDao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: viewerPublicId, viewerMongoId: String(viewerInternalId) }, {
      limit: 2,
    });
    await Post.updateOne(
      { _id: objectIdFor(3) },
      { $set: { likesCount: 1_000 } },
    );
    const continuation = await walkCursor(async (cursor, page) => ({
      result: await feedReadDao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: viewerPublicId, viewerMongoId: String(viewerInternalId) }, {
        limit: 2,
        cursor: page === 1 ? first.nextCursor : cursor,
      }),
      dataSource: "mongo:ranked",
    }));
    const observed: JourneyObservation = {
      pages: [observePage(first, "mongo:ranked"), ...continuation.pages],
      identities: [
        ...first.data.map((post) => post.publicId),
        ...continuation.identities,
      ],
      termination: continuation.termination,
    };
    const expected = expectedJourney(expectedIds, 2, "mongo:ranked");

    assertContract(
      "F04 mutable score",
      "A continuation must not silently omit an item from the initial ranked snapshot when its live score crosses the prior cursor.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("keeps cursor and cache-key growth bounded across 100 ranked pages", async function () {
    this.timeout(60_000);
    await seedPosts(
      Array.from({ length: 201 }, (_, index) => ({
        order: index + 1,
        likes: index + 1,
      })),
    );

    const progression: Array<{
      page: number;
      cursorLength: number;
      seen: number;
      seenPublicIds: number;
      pending: number;
      cacheKeyLength: number;
      snapshotId: string;
    }> = [];
    let cursor: string | undefined;

    for (let page = 1; page <= 100; page += 1) {
      const result = await feedReadDao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: viewerPublicId, viewerMongoId: String(viewerInternalId), destination: "home" }, {
        limit: 2,
        cursor,
      });
      expect(result.nextCursor, `page ${page} must continue`).to.be.a("string");
      cursor = result.nextCursor!;
      const decoded = decodeFeedCursor(cursor, {
        feed: "personalized",
        orders: [FEED_CURSOR_ORDER.PERSONALIZED_RANKED],
        source: "mongo",
      });
      const snapshotKey = `feed_cursor_snapshot:v1:${decoded.snapshotId}`;
      expect(await redisService.clientInstance.exists(snapshotKey)).to.equal(1);
      const raw = decoded as unknown as Record<string, unknown>;
      progression.push({
        page,
        cursorLength: cursor.length,
        seen: Array.isArray(raw.seen) ? raw.seen.length : 0,
        seenPublicIds: Array.isArray(raw.seenPublicIds)
          ? raw.seenPublicIds.length
          : 0,
        pending: Array.isArray(raw.pending) ? raw.pending.length : 0,
        cacheKeyLength: snapshotKey.length,
        snapshotId: decoded.snapshotId,
      });
      expect(decoded.version).to.equal(FEED_CURSOR_VERSION);
    }

    const cursorLengths = progression.map((entry) => entry.cursorLength);
    const cacheKeyLengths = progression.map((entry) => entry.cacheKeyLength);
    const diagnostics = JSON.stringify(
      progression.filter((entry) => [1, 10, 25, 50, 100].includes(entry.page)),
    );
    expect(Math.max(...cursorLengths), diagnostics).to.be.at.most(
      MAX_FEED_CURSOR_ENCODED_LENGTH,
    );
    expect(
      Math.max(...cursorLengths) - Math.min(...cursorLengths),
      diagnostics,
    ).to.be.at.most(16);
    expect(new Set(cacheKeyLengths).size, diagnostics).to.equal(1);
    expect(new Set(progression.map((entry) => entry.snapshotId)).size).to.equal(
      1,
    );
    expect(
      progression.every(
        (entry) =>
          entry.seen === 0 && entry.seenPublicIds === 0 && entry.pending === 0,
      ),
      diagnostics,
    ).to.equal(true);
    const snapshotTtl = await redisService.clientInstance.ttl(
      `feed_cursor_snapshot:v1:${progression[0].snapshotId}`,
    );
    expect(snapshotTtl, diagnostics).to.be.greaterThan(0);
    expect(snapshotTtl, diagnostics).to.be.at.most(3_600);
  });

  it("continues the personalized snapshot across authors without returning prior-page identities", async () => {
    await seedPosts([
      ...[8, 7, 6].map((order) => ({
        order,
        authorId: followedAuthorId,
        authorPublicId: "feed-followed-author",
      })),
      ...[5, 4, 3, 2, 1].map((order) => ({ order })),
    ]);
    const expectedIds = descendingPublicIds(8);
    const observed = await walkCursor(async (cursor, page) => ({
      result: await personalizedHandler.execute(
        new GetPersonalizedFeedQuery(viewerPublicId, page, 2, cursor),
      ),
      dataSource: "mongo:ranked",
    }));
    const expected = expectedJourney(expectedIds, 2, "mongo:ranked");

    assertContract(
      "F03 personalized exhaustion",
      "Personalized snapshot traversal must preserve one global visible sequence across authors.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("keeps hasMore and unique visible identities after personalized deduplication", async () => {
    await seedPosts([
      {
        order: 5,
        authorId: followedAuthorId,
        authorPublicId: "feed-followed-author",
      },
      ...[4, 3, 2].map((order) => ({ order })),
      { order: 1, type: "repost", repostOfOrder: 5 },
    ]);
    const result = await personalizedHandler.execute(
      new GetPersonalizedFeedQuery(viewerPublicId, 1, 2),
    );
    const observed = observePage(result, "mongo:ranked");
    const expected: PageObservation = {
      ids: [publicIdFor(5), publicIdFor(4)],
      hasMore: true,
      nextCursor: "present",
      dataSource: "mongo:ranked",
      cursorSource: "mongo:ranked",
    };

    assertContract(
      "F03 personalized identity deduplication",
      "Deduplication must happen before the limit+1 sentinel decides hasMore and nextCursor.",
      expected,
      observed,
    );
    const rest = await walkCursor(async (cursor, page) => ({
      result: await personalizedHandler.execute(
        new GetPersonalizedFeedQuery(
          viewerPublicId, page + 1, 2, page === 1 ? result.nextCursor : cursor,
        ),
      ),
      dataSource: "mongo:ranked",
    }));
    expect([...result.data.map((post) => post.publicId), ...rest.identities])
      .to.deep.equal(descendingPublicIds(5, 2));
  });

  it("does not skip the first New identity after a full Trending page exhausts", async () => {
    await seedPosts([
      { order: 6, likes: 10 },
      { order: 5, likes: 10 },
      ...[4, 3, 2, 1].map((order) => ({ order, likes: 0 })),
    ]);
    const expectedIds = descendingPublicIds(6);
    const observed = await walkCursor(async (cursor, page) => {
      const result = await trendingHandler.execute(
        new GetTrendingFeedQuery(page, 2, cursor),
      );
      const inNewPhase = cursor?.startsWith("new_phase:") === true;
      return {
        result,
        dataSource: inNewPhase ? "mongo:new" : "mongo:trending",
        cursorSource: inNewPhase ? "mongo:new" : "mongo:new-transition",
      };
    });
    const expected: JourneyObservation = {
      pages: [
        {
          ids: [publicIdFor(6), publicIdFor(5)],
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:trending",
          cursorSource: "mongo:new-transition",
        },
        {
          ids: [publicIdFor(4), publicIdFor(3)],
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:new",
          cursorSource: "mongo:new",
        },
        {
          ids: [publicIdFor(2), publicIdFor(1)],
          hasMore: false,
          nextCursor: "absent",
          dataSource: "mongo:new",
          cursorSource: "none",
        },
      ],
      identities: expectedIds,
      termination: "exhausted",
    };

    assertContract(
      "F04 full Trending-to-New transition",
      "A transition cursor must anchor after the last row actually returned, never after a discarded New page.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("fills a partial final Trending page before continuing in New", async () => {
    await seedPosts([
      { order: 6, likes: 10 },
      { order: 5, likes: 10 },
      ...[4, 3, 2, 1].map((order) => ({ order, likes: 0 })),
    ]);
    const expectedIds = descendingPublicIds(6);
    const observed = await walkCursor(async (cursor, page) => {
      const result = await trendingHandler.execute(
        new GetTrendingFeedQuery(page, 3, cursor),
      );
      const inNewPhase = cursor?.startsWith("new_phase:") === true;
      return {
        result,
        dataSource: inNewPhase ? "mongo:new" : "mongo:trending+new",
        cursorSource: "mongo:new",
      };
    });
    const expected: JourneyObservation = {
      pages: [
        {
          ids: [publicIdFor(6), publicIdFor(5), publicIdFor(4)],
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:trending+new",
          cursorSource: "mongo:new",
        },
        {
          ids: [publicIdFor(3), publicIdFor(2), publicIdFor(1)],
          hasMore: false,
          nextCursor: "absent",
          dataSource: "mongo:new",
          cursorSource: "none",
        },
      ],
      identities: expectedIds,
      termination: "exhausted",
    };

    assertContract(
      "F04 partial Trending-to-New transition",
      "After post-filter deduplication, a partial page must keep fetching until full or truly exhausted.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("keeps the Mongo preference cursor when legacy Redis entries appear between pages", async () => {
    await seedPosts(
      Array.from({ length: 6 }, (_, index) => ({
        order: index + 1,
        publicId: `000-feed-${String(index + 1).padStart(2, "0")}`,
        likes: 5,
      })),
    );
    const first = await forYouHandler.execute(
      new GetForYouFeedQuery(viewerPublicId, 1, 2),
    );
    const decoded = decodeFeedCursor(first.nextCursor!, {
      feed: "for-you",
      orders: [FEED_CURSOR_ORDER.FOR_YOU],
      source: "mongo",
    });
    expect(decoded.snapshotId).to.be.a("string");

    const key = `feed:for_you:${viewerPublicId}`;
    await redisService.clientInstance.zAdd(
      key,
      Array.from({ length: 6 }, (_, index) => ({
        score: 100,
        value: `000-feed-${String(index + 1).padStart(2, "0")}`,
      })),
    );
    const second = await forYouHandler.execute(
      new GetForYouFeedQuery(viewerPublicId, 2, 2, first.nextCursor),
    );
    const observed: JourneyObservation = {
      pages: [
        observePage(first, "mongo:ranked"),
        observePage(second, "mongo:ranked"),
      ],
      identities: [...first.data, ...second.data].map((post) => post.publicId),
      termination: "max-pages",
    };
    const expectedIds = [
      "000-feed-06",
      "000-feed-05",
      "000-feed-04",
      "000-feed-03",
    ];
    const expected: JourneyObservation = {
      pages: [
        {
          ids: expectedIds.slice(0, 2),
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:ranked",
          cursorSource: "mongo:ranked",
        },
        {
          ids: expectedIds.slice(2),
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:ranked",
          cursorSource: "mongo:ranked",
        },
      ],
      identities: expectedIds,
      termination: "max-pages",
    };

    assertContract(
      "F05 Mongo preference cursor isolation",
      "Legacy Redis entries must not change the Mongo snapshot source or repeat page one.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("ignores a conflicting legacy ZSET and continues the pinned preference snapshot when it is removed", async () => {
    await seedPosts(
      Array.from({ length: 6 }, (_, index) => ({
        order: index + 1,
        publicId: `redis-feed-${String(index + 1).padStart(2, "0")}`,
        likes: index + 1,
      })),
    );
    const key = `feed:for_you:${viewerPublicId}`;
    await redisService.clientInstance.zAdd(
      key,
      Array.from({ length: 6 }, (_, index) => ({
        score: 6 - index,
        value: `redis-feed-${String(index + 1).padStart(2, "0")}`,
      })),
    );
    const first = await forYouHandler.execute(
      new GetForYouFeedQuery(viewerPublicId, 1, 2),
    );
    expect(decodeFeedCursor(first.nextCursor!, { feed: "for-you", orders: [FEED_CURSOR_ORDER.FOR_YOU] }).source).to.equal("mongo");
    await redisService.clientInstance.del(key);
    const second = await forYouHandler.execute(
      new GetForYouFeedQuery(viewerPublicId, 2, 2, first.nextCursor),
    );
    const observed: JourneyObservation = {
      pages: [
        observePage(first, "mongo:ranked"),
        observePage(second, "mongo:ranked"),
      ],
      identities: [...first.data, ...second.data].map((post) => post.publicId),
      termination: "max-pages",
    };
    const expectedIds = [
      "redis-feed-06",
      "redis-feed-05",
      "redis-feed-04",
      "redis-feed-03",
    ];
    const expected: JourneyObservation = {
      pages: [
        {
          ids: expectedIds.slice(0, 2),
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:ranked",
          cursorSource: "mongo:ranked",
        },
        {
          ids: expectedIds.slice(2),
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:ranked",
          cursorSource: "mongo:ranked",
        },
      ],
      identities: expectedIds,
      termination: "max-pages",
    };

    assertContract(
      "F05 preference snapshot isolation",
      "Legacy ZSET contents and removal must not override preference ranking or restart pagination.",
      withDiagnostics(expected, expectedIds),
      withDiagnostics(observed, expectedIds),
    );
  });

  it("populates a complete For You snapshot and consumes it across fresh requests", async () => {
    sinon.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    await seedPosts(
      Array.from({ length: 7 }, (_, index) => ({
        order: index + 1,
        publicId: `stable-feed-${String(index + 1).padStart(2, "0")}`,
        likes: index + 1,
      })),
    );
    const expectedIds = Array.from({ length: 7 }, (_, index) =>
      `stable-feed-${String(7 - index).padStart(2, "0")}`,
    );
    const aggregate = sinon.spy(Post, "aggregate");
    const rankingBuilds = () => aggregate.getCalls().filter(({ args }) =>
      (args[0] as mongoose.PipelineStage[]).some((stage) =>
        "$addFields" in stage && "rankBreakdown" in stage.$addFields,
      ),
    ).length;
    const snapshotIds: string[] = [];
    const fetchFreshPage = async (cursor: string | undefined, page: number) => {
      const dao = new FeedReadDao(Post, { findByTags: async () => [] } as unknown as TagRepository, redisService);
      const handler = new GetForYouFeedQueryHandler(
        dao,
        userReadRepository as unknown as IUserReadRepository,
        new FeedPreferenceRepository(FeedProfile, FeedSignal),
        feedEnrichmentService,
      );
      const result = await handler.execute(new GetForYouFeedQuery(viewerPublicId, page, 3, cursor));
      if (result.nextCursor) {
        const decoded = decodeFeedCursor(result.nextCursor, { feed: "for-you", orders: [FEED_CURSOR_ORDER.FOR_YOU] });
        snapshotIds.push(decoded.snapshotId);
        const stored = await redisService.getFeedCursorSnapshot(decoded.snapshotId);
        expect(stored?.entries.map((entry) => entry.publicId)).to.deep.equal(expectedIds);
      }
      return { result, dataSource: "mongo:ranked" };
    };

    const cold = await walkCursor(fetchFreshPage);
    expect(rankingBuilds()).to.equal(1);
    expect(new Set(snapshotIds).size).to.equal(1);

    const warm = await walkCursor(fetchFreshPage);
    expect(rankingBuilds()).to.equal(1);
    expect(snapshotIds).to.have.length(4);
    expect(new Set(snapshotIds).size).to.equal(1);
    const expected = {
      cold: withDiagnostics(
        expectedJourney(expectedIds, 3, "mongo:ranked"),
        expectedIds,
      ),
      warm: withDiagnostics(
        expectedJourney(expectedIds, 3, "mongo:ranked"),
        expectedIds,
      ),
    };
    const observed = {
      cold: withDiagnostics(cold, expectedIds),
      warm: withDiagnostics(warm, expectedIds),
    };

    assertContract(
      "F05 cold/warm For You equivalence",
      "A cold request must persist every ranked entry; fresh requests must consume that snapshot without rebuilding or losing later pages.",
      expected,
      observed,
    );
  });

  it("returns the same New sequence from cold and warm cursor-result caches", async () => {
    await seedPosts(
      Array.from({ length: 8 }, (_, index) => ({ order: index + 1 })),
    );
    const expectedIds = descendingPublicIds(8);
    const daoSpy = sinon.spy(feedReadDao, "getNewFeedWithCursor");

    const cold = await walkCursor(async (cursor, page) => {
      const beforeCalls = daoSpy.callCount;
      const result = await feedReadService.getNewFeed(page, 3, false, cursor);
      return {
        result,
        dataSource:
          daoSpy.callCount > beforeCalls ? "mongo:new" : "redis:new-page",
      };
    });
    const warm = await walkCursor(async (cursor, page) => {
      const beforeCalls = daoSpy.callCount;
      const result = await feedReadService.getNewFeed(page, 3, false, cursor);
      return {
        result,
        dataSource:
          daoSpy.callCount > beforeCalls ? "mongo:new" : "redis:new-page",
      };
    });
    const expected = {
      cold: withDiagnostics(
        expectedJourney(expectedIds, 3, "mongo:new"),
        expectedIds,
      ),
      warm: withDiagnostics(
        expectedJourney(expectedIds, 3, "redis:new-page"),
        expectedIds,
      ),
    };
    const observed = {
      cold: withDiagnostics(cold, expectedIds),
      warm: withDiagnostics(warm, expectedIds),
    };

    const cursorCacheKeys =
      await redisService.clientInstance.keys("new_feed:*");
    expect(cursorCacheKeys).not.to.be.empty;
    const cursorCacheTtls = await Promise.all(
      cursorCacheKeys.map((key) => redisService.clientInstance.ttl(key)),
    );
    expect(cursorCacheTtls.every((ttl) => ttl > 0 && ttl <= 3_600)).to.equal(
      true,
    );

    assertContract(
      "F05 New cold/warm equivalence",
      "A Mongo-produced New cursor must retrieve the identical cached page on a warm replay.",
      expected,
      observed,
    );
  });

  it("lets normal Trending requests consume the actual Trending warmer output", async () => {
    await seedPosts(
      Array.from({ length: 6 }, (_, index) => ({
        order: index + 1,
        likes: index + 1,
      })),
    );

    const worker = createTrendingWorker(
      feedReadDao,
      redisService,
      postReadRepository,
    );

    await (worker as unknown as { fullRefresh(): Promise<void> }).fullRefresh();

    const daoSpy = sinon.spy(feedReadDao, "getTrendingFeedWithCursor");

    const result = await trendingHandler.execute(
      new GetTrendingFeedQuery(1, 2),
    );

    const observed = {
      page: observePage(result, "redis:trending-warmer"),
      requestMongoCalls: daoSpy.callCount,
    };

    const expected = {
      page: {
        ids: [publicIdFor(6), publicIdFor(5)],
        hasMore: true,
        nextCursor: "present",
        dataSource: "redis:trending-warmer",
        cursorSource: "redis:trending-warmer",
      },
      requestMongoCalls: 0,
    };

    assertContract(
      "F05 Trending warmer consumption",
      "The worker ZSET must be directly consumable by the normal Trending handler without a Mongo fallback.",
      expected,
      observed,
    );
  });
  it("consumes every page created by the New warmer through the cursor request path", async () => {
    await seedPosts(
      Array.from({ length: 45 }, (_, index) => ({ order: index + 1 })),
    );
    const worker = new NewFeedWarmCacheWorker(feedReadService);
    await worker.init();
    const daoSpy = sinon.spy(feedReadDao, "getNewFeedWithCursor");
    const first = await feedReadService.getNewFeed(1, 20, false);
    const firstSource =
      daoSpy.callCount === 0 ? "redis:new-warmer" : "mongo:new";
    const beforeSecond = daoSpy.callCount;
    const second = await feedReadService.getNewFeed(
      2,
      20,
      false,
      first.nextCursor,
    );
    const secondSource =
      daoSpy.callCount > beforeSecond ? "mongo:new" : "redis:new-warmer";
    const observed = {
      pages: [
        observePage(first, firstSource, "mongo:new-warmer"),
        observePage(second, secondSource, "mongo:new-warmer"),
      ],
      identities: [...first.data, ...second.data].map((post) => post.publicId),
    };
    const expectedIds = descendingPublicIds(45, 6);
    const expected = {
      pages: [
        {
          ids: expectedIds.slice(0, 20),
          hasMore: true,
          nextCursor: "present",
          dataSource: "redis:new-warmer",
          cursorSource: "mongo:new-warmer",
        },
        {
          ids: expectedIds.slice(20, 40),
          hasMore: true,
          nextCursor: "present",
          dataSource: "redis:new-warmer",
          cursorSource: "mongo:new-warmer",
        },
      ],
      identities: expectedIds,
    };

    assertContract(
      "F05/F07 New warmer key compatibility",
      "A normal cursor continuation must consume the page-two cache entry already produced by the warmer.",
      expected,
      observed,
    );
  });

  it("rejects malformed, wrong-version, and wrong-feed cursors at the public route", async () => {
    await seedPosts(
      Array.from({ length: 4 }, (_, index) => ({
        order: index + 1,
        likes: index + 1,
      })),
    );
    const app = buildFeedApp();
    const cursors = [
      { kind: "malformed", value: "not-base64-json" },
      {
        kind: "wrong-version",
        value: encodeAuthenticatedCursor(
          {
            version: 999,
            feed: "new",
            order: FEED_CURSOR_ORDER.NEW,
            source: "mongo",
            phase: "new",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            createdAt: fixedCreatedAt.toISOString(),
            _id: objectIdFor(3).toHexString(),
          },
          feedCursorTestSecret,
        ),
      },
      {
        kind: "wrong-feed",
        value: encodeFeedCursor({
          feed: "trending",
          order: FEED_CURSOR_ORDER.TRENDING,
          source: "mongo",
          phase: "trending",
          snapshotId: `${hashFeedCursorScope(["wrong-feed"])}.1`,
          offset: 2,
        }),
      },
      {
        kind: "oversized",
        value: "x".repeat(MAX_FEED_CURSOR_ENCODED_LENGTH + 1),
      },
    ];
    const observed: Array<{
      kind: string;
      status: number;
      ids: string[];
    }> = [];
    for (const cursor of cursors) {
      const response = await request(app)
        .get("/api/feed/new")
        .query({ limit: 2, cursor: cursor.value });
      const body = response.body as { data?: Array<{ publicId: string }> };
      observed.push({
        kind: cursor.kind,
        status: response.status,
        ids: body.data?.map((post) => post.publicId) ?? [],
      });
    }
    const expected = cursors.map((cursor) => ({
      kind: cursor.kind,
      status: 400,
      ids: [],
    }));

    assertContract(
      "F07 strict public cursor validation",
      "Invalid, unsupported-version, and wrong-feed cursor tokens must fail once with 400 rather than restart or reinterpret a feed.",
      expected,
      observed,
    );
  });

  it("returns only the New delta relative to the caller's visible head without replacing the shared first page", async () => {
    await seedPosts(
      Array.from({ length: 4 }, (_, index) => ({ order: index + 1 })),
    );
    const first = await feedReadService.getNewFeed(1, 3, false);
    const key = CacheKeyBuilder.getNewFeedKey(1, 3);
    const cachedBefore = await redisService.getWithTags<CoreFeed>(key);
    await seedPosts([{ order: 5 }]);
    const refreshed = await feedReadService.getNewFeed(1, 3, true);
    const cachedAfter = await redisService.getWithTags<CoreFeed>(key);
    const observed = {
      visibleHead: first.data[0]?.publicId,
      refreshIds: refreshed.data.map((post) => post.publicId),
      sharedBefore: cachedBefore?.data.map((post) => post.publicId),
      sharedAfter: cachedAfter?.data.map((post) => post.publicId),
    };
    const expected = {
      visibleHead: publicIdFor(4),
      refreshIds: [publicIdFor(5)],
      sharedBefore: [publicIdFor(4), publicIdFor(3), publicIdFor(2)],
      sharedAfter: [publicIdFor(4), publicIdFor(3), publicIdFor(2)],
    };

    assertContract(
      "F06 head-relative New refresh",
      "Refresh must be a caller-relative newer-than-head delta and must not rebuild the shared first-page cache.",
      expected,
      observed,
    );
  });

  it("does not show an original and its repost wrapper as the same visible identity on separate pages", async () => {
    await seedPosts([
      { order: 6, publicId: "original-post" },
      {
        order: 5,
        publicId: "repost-wrapper",
        type: "repost",
        repostOfOrder: 6,
      },
      { order: 4 },
      { order: 3 },
    ]);
    const journey = await walkCursor(async (cursor) => ({
      result: await feedReadDao.getNewFeedWithCursor({ limit: 1, cursor }),
      dataSource: "mongo:new",
    }));
    const allPosts: Array<{
      publicId: string;
      repostOf?: { publicId?: string } | null;
    }> = [];
    let cursor: string | undefined;
    for (let page = 1; page <= 10; page += 1) {
      const result = await feedReadDao.getNewFeedWithCursor({
        limit: 1,
        cursor,
      });
      allPosts.push(...result.data);
      if (!result.hasMore || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    const visibleIdentities = allPosts.map(
      (post) => post.repostOf?.publicId ?? post.publicId,
    );
    const observed = {
      pages: journey.pages,
      transportIds: allPosts.map((post) => post.publicId),
      visibleIdentities,
      repeatedTransportIds: duplicateIds(allPosts.map((post) => post.publicId)),
      repeatedVisibleIdentities: duplicateIds(visibleIdentities),
    };
    const expected = {
      pages: [
        {
          ids: ["original-post"],
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:new",
          cursorSource: "mongo:new",
        },
        {
          ids: [publicIdFor(4)],
          hasMore: true,
          nextCursor: "present",
          dataSource: "mongo:new",
          cursorSource: "mongo:new",
        },
        {
          ids: [publicIdFor(3)],
          hasMore: false,
          nextCursor: "absent",
          dataSource: "mongo:new",
          cursorSource: "none",
        },
      ],
      transportIds: ["original-post", publicIdFor(4), publicIdFor(3)],
      visibleIdentities: ["original-post", publicIdFor(4), publicIdFor(3)],
      repeatedTransportIds: [],
      repeatedVisibleIdentities: [],
    };

    assertContract(
      "F03/F10 repost visible identity",
      "The first visible representation wins; later wrappers of the same original content must not consume another feed position.",
      expected,
      observed,
    );
  });

  it("keeps mixed Redis metadata hits and misses from changing a warm New page sequence", async () => {
    await seedPosts(
      Array.from({ length: 3 }, (_, index) => ({ order: index + 1 })),
    );
    await redisService.set(
      CacheKeyBuilder.getPostMetaKey(asPostPublicId(publicIdFor(3))),
      { likes: 99, commentsCount: 0, viewsCount: 0 },
      300,
    );
    const cold = await feedReadService.getNewFeed(1, 3, false);
    await redisService.set(
      CacheKeyBuilder.getPostMetaKey(asPostPublicId(publicIdFor(2))),
      { likes: 77, commentsCount: 0, viewsCount: 0 },
      300,
    );
    const warm = await feedReadService.getNewFeed(1, 3, false);
    const observed = {
      coldIds: cold.data.map((post) => post.publicId),
      warmIds: warm.data.map((post) => post.publicId),
      coldLikes: cold.data.map((post) => post.likes),
      warmLikes: warm.data.map((post) => post.likes),
    };
    const expected = {
      coldIds: descendingPublicIds(3),
      warmIds: descendingPublicIds(3),
      coldLikes: [99, 0, 0],
      warmLikes: [99, 77, 0],
    };

    assertContract(
      "F08 enrichment equivalence",
      "Batched metadata cache hits and misses may refresh counts but must not alter page membership or order.",
      expected,
      observed,
    );
  });

  it("documents the active /api/posts offset route and its insert-between-pages instability", async () => {
    await seedPosts(
      Array.from({ length: 6 }, (_, index) => ({
        order: index + 1,
        likes: 1,
      })),
    );
    const app = buildLegacyPostsApp();
    const firstResponse = await request(app)
      .get("/api/posts")
      .query({ page: 1, limit: 2 })
      .expect(200);
    if (
      !Array.isArray(firstResponse.body.data) ||
      firstResponse.body.data.length === 0
    ) {
      throw new Error(
        `[F01] Unexpected first /api/posts response:\n${JSON.stringify(
          firstResponse.body,
          null,
          2,
        )}`,
      );
    }
    await seedPosts([{ order: 7, likes: 1 }]);
    const secondResponse = await request(app)
      .get("/api/posts")
      .query({ page: 2, limit: 2 })
      .expect(200);
    if (
      !Array.isArray(secondResponse.body.data) ||
      secondResponse.body.data.length === 0
    ) {
      throw new Error(
        `[F01] Unexpected second /api/posts response:\n${JSON.stringify(
          secondResponse.body,
          null,
          2,
        )}`,
      );
    }
    const firstBody = firstResponse.body as {
      data: Array<{ publicId: string }>;
      page: number;
    };
    const secondBody = secondResponse.body as {
      data: Array<{ publicId: string }>;
      page: number;
    };
    const actualIds = [...firstBody.data, ...secondBody.data].map(
      (post) => post.publicId,
    );
    const expectedIds = [
      publicIdFor(6),
      publicIdFor(5),
      publicIdFor(4),
      publicIdFor(3),
    ];
    const observed = {
      route: "/api/posts",
      contract: "offset",
      pages: [
        firstBody.data.map((post) => post.publicId),
        secondBody.data.map((post) => post.publicId),
      ],
      pageNumbers: [firstBody.page, secondBody.page],
      repeated: duplicateIds(actualIds),
      missing: expectedIds.filter((id) => !actualIds.includes(id)),
    };
    const expected = {
      route: "/api/posts",
      contract: "offset",
      pages: [expectedIds.slice(0, 2), [publicIdFor(5), publicIdFor(4)]],
      pageNumbers: [1, 2],
      repeated: [publicIdFor(5)],
      missing: [publicIdFor(3)],
    };

    assertContract(
      "F01 active legacy offset route",
      "The still-public offset route must be documented separately; an insert between requests currently must not be mistaken for cursor-stable traversal.",
      expected,
      observed,
    );
  });
});
