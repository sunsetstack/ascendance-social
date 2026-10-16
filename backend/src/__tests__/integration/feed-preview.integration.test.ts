import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import express, { type NextFunction, type Request, type Response } from "express";
import mongoose, { Types } from "mongoose";
import { createClient } from "redis";
import request from "supertest";
import Post from "@/models/post.model";
import { Tag } from "@/models/image.model";
import { FeedReadDao } from "@/repositories/read/FeedReadDao";
import { TagRepository } from "@/repositories/tag.repository";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import type { RedisService } from "@/services/redis.service";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetFeedPreviewQuery } from "@/application/queries/feed/getFeedPreview/getFeedPreview.query";
import { GetFeedPreviewQueryHandler } from "@/application/queries/feed/getFeedPreview/getFeedPreview.handler";
import { FeedController } from "@/controllers/feed.controller";
import { FeedRoutes } from "@/routes/feed.routes";
import { PostRoutes } from "@/routes/post.routes";
import type { FeedPreviewDefinition } from "@/types/customFeeds/feed-preview.types";
import { AppError } from "@/utils/errors";

const mongoUri = process.env.INTEGRATION_MONGODB_URI;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
const databaseName = `ascendance_preview_regression_${randomUUID().replaceAll("-", "")}`;

(mongoUri && redisUrl ? describe : describe.skip)("Feed preview serving contract", function () {
  this.timeout(30_000);
  const authorId = new Types.ObjectId();
  const authorPublicId = randomUUID();
  const tags = { cats: new Types.ObjectId(), photos: new Types.ObjectId(), tools: new Types.ObjectId() };
  const ids = Array.from({ length: 8 }, () => new Types.ObjectId());
  let redis: ReturnType<typeof createClient>;
  let dao: FeedReadDao;
  let app: express.Express;
  let snapshotNamespace: string;
  const definition: FeedPreviewDefinition = { topics: ["cats"], sort: "latest", includeReposts: true };
  const auth = { required: () => (_req: Request, _res: Response, next: NextFunction) => next(), optional: () => (_req: Request, _res: Response, next: NextFunction) => next() };

  before(async () => {
    if (!mongoUri!.startsWith("mongodb://127.0.0.1:") || !redisUrl!.startsWith("redis://127.0.0.1:")) {
      throw new Error("Preview regressions require isolated local MongoDB and Redis instances");
    }
    await mongoose.connect(mongoUri!, { dbName: databaseName, serverSelectionTimeoutMS: 5_000 });
    await Post.init();
    await Tag.init();
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    const snapshots = new RedisFeedModule(redis as never);
    const cache = {
      getOrCreateFeedCursorSnapshot: (key: string, build: Parameters<RedisFeedModule["getOrCreateFeedCursorSnapshot"]>[1]) =>
        snapshots.getOrCreateFeedCursorSnapshot(`${snapshotNamespace}:${key}`, build),
      requireFeedCursorSnapshot: snapshots.requireFeedCursorSnapshot.bind(snapshots),
    } as unknown as RedisService;
    dao = new FeedReadDao(Post, new TagRepository(Tag), cache);
    const enrichment = new FeedEnrichmentService({
      findMany: async () => [{ publicId: authorPublicId, handle: "author", username: "Current author", avatar: "" }],
    } as never, { getPostMetadata: async () => [] } as never);
    const bus = new QueryBus();
    bus.register(GetFeedPreviewQuery, new GetFeedPreviewQueryHandler(dao, enrichment));
    app = express();
    app.use("/api/feed", new FeedRoutes(new FeedController(bus), auth as never).getRouter());
    app.use("/api/posts", new PostRoutes({
      listTags: async (_req: Request, res: Response) => { res.json(await Tag.find({}).lean()); },
    } as never, auth as never).getRouter());
    app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.statusCode ?? 500).json({ error: error.message });
    });
  });

  beforeEach(async () => {
    snapshotNamespace = randomUUID();
    await Post.deleteMany({});
    await Tag.deleteMany({});
    await Tag.insertMany(Object.entries(tags).map(([tag, _id]) => ({ _id, tag })));
    const tagSets = [[tags.tools], [tags.cats], [tags.cats, tags.photos], [tags.photos], [tags.photos], [tags.cats], [tags.cats]];
    await Post.collection.insertMany(tagSets.map((postTags, index) => ({
      _id: ids[index], publicId: `preview-${index + 1}`, user: authorId,
      author: { _id: authorId, publicId: authorPublicId, handle: "author", username: "Old author", avatarUrl: "" },
      body: `Preview post ${index + 1}`, tags: postTags,
      likesCount: index === 2 ? 8 : 0, commentsCount: 0, viewsCount: 0,
      type: index === 4 ? "repost" : "original", repostOf: index === 4 ? ids[3] : null,
      status: index === 5 ? "pending" : "active",
      createdAt: new Date(Date.now() - (index === 4 ? 0 : index + 1) * 86_400_000),
    })));
  });

  after(async () => {
    if (redis?.isOpen) await redis.quit();
    if (mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const publicIds = (page: { data: Array<{ publicId: string }> }) => page.data.map((post) => post.publicId);

  it("serves topic choices to guests through validation, ranking, snapshots, and current identity enrichment", async () => {
    const response = await request(app).get("/api/feed/preview?topics=cats&limit=10").expect(200);
    expect(publicIds(response.body)).to.deep.equal(["preview-2", "preview-3", "preview-7"]);
    expect(response.body.data.every((post: { user: { username: string } }) => post.user.username === "Current author")).to.equal(true);
    expect(response.body.hasMore).to.equal(false);
  });

  it("combines topics with OR and preserves strict empty selections", async () => {
    const combined = await dao.getPreviewFeedWithCursor({ ...definition, topics: ["cats", "tools"] }, { limit: 10 });
    expect(publicIds(combined)).to.deep.equal(["preview-1", "preview-2", "preview-3", "preview-7"]);
    const empty = await dao.getPreviewFeedWithCursor({ ...definition, topics: ["unknown"] }, { limit: 10 });
    expect(empty.data).to.deep.equal([]);
    expect(empty.hasMore).to.equal(false);
    expect(empty.nextCursor).to.equal(undefined);
  });

  it("changes ordering meaningfully and returns originals when reposts are excluded", async () => {
    const relevant = await dao.getPreviewFeedWithCursor({ ...definition, sort: "relevant" }, { limit: 10 });
    expect(publicIds(relevant)).to.deep.equal(["preview-3", "preview-2", "preview-7"]);
    const withReposts = await dao.getPreviewFeedWithCursor({ ...definition, topics: ["photos"] }, { limit: 10 });
    expect(publicIds(withReposts)).to.deep.equal(["preview-5", "preview-3"]);
    const originals = await dao.getPreviewFeedWithCursor({ ...definition, topics: ["photos"], includeReposts: false }, { limit: 10 });
    expect(publicIds(originals)).to.deep.equal(["preview-3", "preview-4"]);
  });

  it("pins pagination across score updates, inserts, and cache reuse", async () => {
    const settings = { ...definition, sort: "relevant" as const };
    const first = await dao.getPreviewFeedWithCursor(settings, { limit: 1 });
    expect(publicIds(first)).to.deep.equal(["preview-3"]);
    expect(first.nextCursor).to.be.a("string");
    await Post.updateOne({ _id: ids[6] }, { $set: { likesCount: 9999 } });
    await Post.collection.insertOne({
      _id: ids[7], publicId: "preview-new", user: authorId,
      author: { _id: authorId, publicId: authorPublicId, handle: "author", username: "Author" },
      tags: [tags.cats], status: "active", type: "original", createdAt: new Date(),
      likesCount: 99999,
    });
    const repeated = await dao.getPreviewFeedWithCursor(settings, { limit: 1 });
    expect(publicIds(repeated)).to.deep.equal(publicIds(first));
    const rest = await dao.getPreviewFeedWithCursor(settings, { limit: 10, cursor: first.nextCursor });
    expect(publicIds(rest)).to.deep.equal(["preview-2", "preview-7"]);
    expect(rest.hasMore).to.equal(false);
  });

  it("rechecks current topic eligibility and deletion while hydrating a pinned snapshot", async () => {
    const first = await dao.getPreviewFeedWithCursor(definition, { limit: 1 });
    await Post.updateOne({ _id: ids[2] }, { $set: { tags: [tags.tools] } });
    await Post.deleteOne({ _id: ids[6] });
    const rest = await dao.getPreviewFeedWithCursor(definition, { limit: 10, cursor: first.nextCursor });
    expect(rest.data).to.deep.equal([]);
    expect(rest.hasMore).to.equal(false);
  });

  it("rejects cursors from other choices and malformed control input", async () => {
    const first = await dao.getPreviewFeedWithCursor(definition, { limit: 1 });
    await request(app).get("/api/feed/preview").query({ topics: "photos", cursor: first.nextCursor }).expect(400);
    for (const query of ["sort=random", "includeReposts=no", "topics=%24where", "topics=a&topics=b&topics=c&topics=d&topics=e&topics=f", "cursor=broken"]) {
      await request(app).get(`/api/feed/preview?${query}`).expect(400);
    }
  });

  it("keeps the topic catalogue reachable ahead of the generic post-id route", async () => {
    const response = await request(app).get("/api/posts/tags").expect(200);
    expect(response.body.map((tag: { tag: string }) => tag.tag).sort()).to.deep.equal(["cats", "photos", "tools"]);
  });
});
