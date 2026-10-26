import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import { createClient } from "redis";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import Post from "@/models/post.model";
import User from "@/models/user.model";
import Image, { Tag } from "@/models/image.model";
import PostLike from "@/models/postLike.model";
import Follow from "@/models/follow.model";
import UserAction from "@/models/userAction.model";
import { Comment } from "@/models/comment.model";
import { OutboxModel } from "@/models/outbox.model";
import { FeedProfile, FeedSignal } from "@/models/feed-profile.model";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { FeedReadDao } from "@/repositories/read/FeedReadDao";
import { PostReadRepository } from "@/repositories/read/PostReadRepository";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { UserWriteRepository } from "@/repositories/write/UserWriteRepository";
import { FollowRepository } from "@/repositories/follow.repository";
import { TagRepository } from "@/repositories/tag.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { CommentRepository } from "@/repositories/comment.repository";
import { ImageRepository } from "@/repositories/image.repository";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { QueryBus } from "@/application/common/buses/query.bus";
import { CommandBus } from "@/application/common/buses/command.bus";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import type { RedisService } from "@/services/redis.service";
import { DTOService } from "@/services/dto.service";
import { ImageService } from "@/services/image.service";
import { AttachmentTransactionService } from "@/services/image/attachment-transaction.service";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { LikeActionByPublicIdCommandHandler } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.handler";
import { LikeActionByPublicIdCommand } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.command";
import { RepostPostCommandHandler } from "@/application/commands/post/repostPost/repostPost.handler";
import { RepostPostCommand } from "@/application/commands/post/repostPost/repostPost.command";
import { UnrepostPostCommandHandler } from "@/application/commands/post/unrepostPost/unrepostPost.handler";
import { UnrepostPostCommand } from "@/application/commands/post/unrepostPost/unrepostPost.command";
import { CreateCommentCommandHandler } from "@/application/commands/comments/createComment/create-comment.handler";
import { CreateCommentCommand } from "@/application/commands/comments/createComment/createComment.command";
import { DeleteCommentCommandHandler } from "@/application/commands/comments/deleteComment/delete-comment.handler";
import { DeleteCommentCommand } from "@/application/commands/comments/deleteComment/deleteComment.command";
import { UpdateInterestsCommandHandler } from "@/application/commands/feed/updateInterests/updateInterests.handler";
import { UpdateInterestsCommand } from "@/application/commands/feed/updateInterests/updateInterests.command";
import { GetInterestsQuery, GetInterestFeedQuery } from "@/application/queries/feed/interests/interests.query";
import { GetInterestsQueryHandler, GetInterestFeedQueryHandler } from "@/application/queries/feed/interests/interests.handler";
import { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { FeedRoutes } from "@/routes/feed.routes";
import { FeedController } from "@/controllers/feed.controller";
import { CommentRoutes } from "@/routes/comment.routes";
import { CommentController } from "@/controllers/comment.controller";
import { PostRoutes } from "@/routes/post.routes";
import { PostController } from "@/controllers/post.controller";
import { classifyContent } from "@/services/feed/interests.policy";
import { buildInterestScoreStages } from "@/services/feed/interest-ranking.policy";
import { MAX_FEED_CURSOR_SNAPSHOT_ITEMS, FEED_CURSOR_ORDER, decodeFeedCursor, encodeFeedCursor, hashFeedCursorScope } from "@/utils/feedCursor";
import { backfillContentFeatures } from "@/services/feed/backfill-content-features";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asPostPublicId } from "@/types/branded";
import type { IPost } from "@/types";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import { CreatePostCommand } from "@/application/commands/post/createPost/createPost.command";
import { CreatePostCommandHandler } from "@/application/commands/post/createPost/createPost.handler";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { TagService } from "@/services/tag.service";

const uri = process.env.INTEGRATION_MONGODB_URI;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
const databaseName = `ascendance_interests_${randomUUID().replaceAll("-", "")}`;

(uri && redisUrl ? describe : describe.skip)("Interests, preference learning, and media lifecycle", function () {
  this.timeout(30_000);
  const actorId = new Types.ObjectId();
  const authorId = new Types.ObjectId();
  const actor = asUserPublicId(randomUUID());
  const author = asUserPublicId(randomUUID());
  let redis: ReturnType<typeof createClient>;
  let dao: FeedReadDao;
  let preferences: FeedPreferenceRepository;
  let unit: UnitOfWork;
  let likes: LikeActionByPublicIdCommandHandler;
  let reposts: RepostPostCommandHandler;
  let unreposts: UnrepostPostCommandHandler;
  let comments: CreateCommentCommandHandler;
  let deleteComments: DeleteCommentCommandHandler;
  let updates: UpdateInterestsCommandHandler;
  let forYou: GetForYouFeedQueryHandler;
  let cleanup: ContentCleanupService;
  let attachments: AttachmentTransactionService;
  let images: ImageService;
  let events: EventBus;
  let app: express.Express;
  let cryptoPost: IPost;
  let financePost: IPost;
  let cryptoImage: IPost;
  let namespace: string;
  const deletedAssets: string[] = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");

  async function addFormatPosts(body: string, count: number, image = false): Promise<IPost[]> {
    return Post.insertMany(Array.from({ length: count }, () => ({
      publicId: asPostPublicId(randomUUID()), user: authorId,
      author: { _id: authorId, publicId: author, handle: "author", username: "Author" },
      body, image: image ? cryptoImage.image : null, contentFeatures: classifyContent(body, [], image),
      createdAt: new Date(Date.now() - 60_000),
    })));
  }

  before(async () => {
    if (!uri!.startsWith("mongodb://127.0.0.1:") || !redisUrl!.startsWith("redis://127.0.0.1:")) throw new Error("Isolated local test services required");
    await mongoose.connect(uri!, { dbName: databaseName, serverSelectionTimeoutMS: 5_000 });
    for (const model of [Post, User, Image, Tag, PostLike, UserAction, Comment, OutboxModel, FeedProfile, FeedSignal]) await model.init();
    redis = createClient({ url: redisUrl! }); await redis.connect();
    const snapshots = new RedisFeedModule(redis as never);
    dao = new FeedReadDao(Post, new TagRepository(Tag), {
      getOrCreateFeedCursorSnapshot: (key: string, build: Parameters<RedisFeedModule["getOrCreateFeedCursorSnapshot"]>[1]) => snapshots.getOrCreateFeedCursorSnapshot(`${namespace}:${key}`, build),
      requireFeedCursorSnapshot: snapshots.requireFeedCursorSnapshot.bind(snapshots),
    } as unknown as RedisService);
    unit = new UnitOfWork();
    preferences = new FeedPreferenceRepository(FeedProfile, FeedSignal);
    const users = new UserReadRepository(User, new FollowRepository(Follow));
    const reads = new PostReadRepository(Post);
    const writes = new PostWriteRepository(Post);
    events = new EventBus(new OutboxRepository(OutboxModel), new MetricsService());
    images = new ImageService(new ImageRepository(Image), {
      uploadImageStream: async () => ({ publicId: `synthetic/${randomUUID()}`, url: "/synthetic/fixture.png", width: 1, height: 1 }),
      deleteImage: async (id: string) => { deletedAssets.push(id); },
    } as never);
    attachments = new AttachmentTransactionService(images, unit, events);
    cleanup = new ContentCleanupService(Post);
    likes = new LikeActionByPublicIdCommandHandler(preferences, unit, reads, writes, new PostLikeRepository(PostLike), new UserActionRepository(UserAction), users, events, new DTOService());
    reposts = new RepostPostCommandHandler(attachments, preferences, reads, writes, users, new UserWriteRepository(User), new DTOService(), events);
    unreposts = new UnrepostPostCommandHandler(unit, reads, users, cleanup, events);
    comments = new CreateCommentCommandHandler(attachments, reads, writes, new CommentRepository(Comment), users, events);
    deleteComments = new DeleteCommentCommandHandler(unit, reads, new CommentRepository(Comment), users, cleanup, events);
    updates = new UpdateInterestsCommandHandler(users, preferences, unit);
    const enrichment = new FeedEnrichmentService({ findMany: async () => [{ publicId: author, handle: "author", username: "Author", avatar: "" }, { publicId: actor, handle: "synthetic", username: "Synthetic persona", avatar: "" }] } as never, { getPostMetadata: async () => [] } as never);
    forYou = new GetForYouFeedQueryHandler(dao, users, preferences, enrichment);
    const queries = new QueryBus();
    queries.register(GetInterestsQuery, new GetInterestsQueryHandler(users, preferences));
    queries.register(GetInterestFeedQuery, new GetInterestFeedQueryHandler(users, dao, enrichment));
    const commands = new CommandBus();
    commands.register(UpdateInterestsCommand, updates);
    commands.register(CreateCommentCommand, comments);
    commands.register(RepostPostCommand, reposts);
    const tagCache = {
      get: async (key: string) => { const value = await redis.get(`${namespace}:${key}`); return value ? JSON.parse(value) : null; },
      set: async (key: string, value: unknown, ttl: number) => { await redis.set(`${namespace}:${key}`, JSON.stringify(value), { EX: ttl }); },
      invalidateByTags: async () => undefined,
    } as unknown as RedisService;
    commands.register(CreatePostCommand, new CreatePostCommandHandler(unit, reads, writes, users, new UserWriteRepository(User),
      new CommunityRepository(), new CommunityMemberRepository(), new TagService(new TagRepository(Tag), tagCache), images, new DTOService(), events));
    const auth = {
      optional: () => (req: Request, _res: Response, next: NextFunction) => { if (req.headers.authorization === "Synthetic persona") req.decodedUser = { publicId: actor } as never; next(); },
      required: () => (req: Request, res: Response, next: NextFunction) => { if (req.headers.authorization !== "Synthetic persona") { res.status(401).send(); return; } req.decodedUser = { publicId: actor } as never; next(); },
    };
    app = express(); app.use(express.json());
    app.use("/api/feed", new FeedRoutes(new FeedController(queries, commands), auth as never).getRouter());
    app.use("/api", new CommentRoutes(new CommentController(commands, queries), auth as never).getRouter());
    app.use("/api/posts", new PostRoutes(new PostController(commands, queries), auth as never).getRouter());
    app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => res.status(error.statusCode ?? 500).json({ error: error.message }));
  });

  beforeEach(async () => {
    namespace = randomUUID(); deletedAssets.length = 0;
    for (const model of [Post, User, Image, Tag, PostLike, UserAction, Comment, OutboxModel, FeedProfile, FeedSignal]) await model.collection.deleteMany({});
    await User.collection.insertMany([
      { _id: actorId, publicId: actor, email: "synthetic@example.invalid", handle: "synthetic", username: "Synthetic persona", postCount: 0 },
      { _id: authorId, publicId: author, email: "author@example.invalid", handle: "author", username: "Author", postCount: 0 },
    ]);
    const create = async (body: string, image = false) => Post.create({ publicId: asPostPublicId(randomUUID()), user: authorId,
      author: { _id: authorId, publicId: author, handle: "author", username: "Author" },
      body, image: image ? (await Image.create({ user: authorId, publicId: randomUUID(), url: "/synthetic/crypto.png", originalName: "crypto.png", slug: "crypto", width: 1, height: 1 }))._id : null, contentFeatures: classifyContent(body, [], image),
      createdAt: new Date(Date.now() - 60_000),
    });
    cryptoPost = await create("Ethereum blockchain");
    financePost = await create("Business finance");
    cryptoImage = await create("#crypto", true);
  });

  after(async () => {
    if (redis?.isOpen) await redis.quit();
    if (mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("serves a curated catalogue, validates topic IDs, and protects saved choices", async () => {
    const catalogue = await request(app).get("/api/feed/interests").expect(200);
    expect(catalogue.body.profile).to.equal(null);
    expect(catalogue.body.catalogue.map((item: { id: string }) => item.id)).to.include.members(["finance", "crypto", "politics"]);
    await request(app).put("/api/feed/interests").send({ selected: ["crypto"] }).expect(401);
    await request(app).put("/api/feed/interests").set("Authorization", "Synthetic persona").send({ selected: ["invented"] }).expect(400);
    await request(app).get("/api/feed/interests/posts?topics=invented").expect(400);
    await request(app).put("/api/feed/interests").set("Authorization", "Synthetic persona").send({ selected: ["finance", "crypto"] }).expect(204);
    expect((await preferences.read(String(actorId))).selected).to.deep.equal(["crypto", "finance"]);
  });

  it("matches untagged prose, restricts Top to the week, and never relaxes topic eligibility", async () => {
    await Post.collection.updateOne({ _id: cryptoPost._id }, { $set: { createdAt: new Date(Date.now() - 8 * 86_400_000), likesCount: 200 } });
    const newest = await request(app).get("/api/feed/interests/posts?topics=crypto").expect(200);
    expect(newest.body.data.map((post: { publicId: string }) => post.publicId)).to.deep.equal([cryptoImage.publicId, cryptoPost.publicId]);
    const top = await request(app).get("/api/feed/interests/posts?topics=crypto&sort=top").expect(200);
    expect(top.body.data.map((post: { publicId: string }) => post.publicId)).to.deep.equal([cryptoImage.publicId]);
    const empty = await request(app).get("/api/feed/interests/posts?topics=politics").expect(200);
    expect(empty.body.data).to.deep.equal([]);
  });

  it("learns from real likes, preserves the original contribution, and reverses an unlike", async () => {
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    const learned = await preferences.read(String(actorId));
    expect(learned.topics.crypto).to.be.greaterThan(2.9);
    expect(await PostLike.countDocuments({ userId: actorId })).to.equal(1);
    await Post.updateOne({ _id: cryptoPost._id }, { $set: { contentFeatures: classifyContent("Business finance", [], false) } });
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    expect((await preferences.read(String(actorId))).topics).to.deep.equal({});
    expect(await FeedSignal.countDocuments()).to.equal(0);
    expect((await Post.findById(cryptoPost._id))?.likesCount).to.equal(0);
  });

  it("keeps format and topic preferences independent, and reset preserves chosen interests", async () => {
    await updates.execute(new UpdateInterestsCommand(actor, "select", ["finance"]));
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoImage.publicId));
    const learned = await preferences.read(String(actorId));
    expect(learned.formats.image).to.be.greaterThan(2.9);
    expect(learned.topics.crypto).to.be.greaterThan(0.59);
    expect(learned.selected).to.deep.equal(["finance"]);
    await updates.execute(new UpdateInterestsCommand(actor, "reset"));
    const reset = await preferences.read(String(actorId));
    expect(reset.selected).to.deep.equal(["finance"]);
    expect(reset.topics).to.deep.equal({}); expect(reset.formats).to.deep.equal({});
    expect(await PostLike.countDocuments()).to.equal(1);
  });

  it("rolls back preference updates and outbox writes with a failed interaction transaction", async () => {
    try {
      await unit.executeInTransaction(async () => {
        await preferences.setSignal(String(actorId), String(cryptoPost._id), "like", cryptoPost.contentFeatures!, true);
        await events.queueTransactional(new PostUploadedEvent(cryptoPost.publicId, actor, []));
        throw new Error("fixture failure");
      }, { maxAttempts: 1 });
      expect.fail("transaction must fail");
    } catch (error) { expect((error as Error).message).to.equal("fixture failure"); }
    expect(await FeedSignal.countDocuments()).to.equal(0);
    expect(await FeedProfile.countDocuments()).to.equal(0);
    expect(await OutboxModel.countDocuments()).to.equal(0);
  });

  it("ranks controlled personas differently and hydrates viewer likes outside snapshots", async () => {
    await updates.execute(new UpdateInterestsCommand(actor, "select", ["finance"]));
    const finance = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    expect(finance.data[0].publicId).to.equal(financePost.publicId);
    expect(finance.data[0].feedReason).to.equal("chosen:finance");
    await updates.execute(new UpdateInterestsCommand(actor, "select", []));
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    const crypto = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    expect(crypto.data[0].publicId).to.equal(cryptoPost.publicId);
    expect(crypto.data[0].feedReason).to.equal("learned:crypto");
    expect(crypto.data.find((post) => post.publicId === cryptoPost.publicId)?.isLikedByViewer).to.equal(true);
    const guest = await dao.getInterestFeedWithCursor({ topics: ["crypto"], sort: "newest" }, { limit: 10 });
    expect(guest.data.every((post) => post.isLikedByViewer === undefined)).to.equal(true);
  });

  it("hydrates only the requested page and one lookahead through Mongo lookups", async () => {
    const posts = await addFormatPosts("TypeScript software", 65);
    const aggregate = sinon.spy(Post, "aggregate");
    try {
      const page = await dao.getInterestFeedWithCursor({ topics: ["technology"], sort: "newest", viewer: actor,
        viewerMongoId: String(actorId) }, { limit: 10 });
      expect(page.data.map(post => post.publicId)).to.deep.equal([...posts].reverse().slice(0, 10).map(post => post.publicId));
      expect(page.hasMore).to.equal(true);
      expect(page.consumedOffset).to.equal(10);
      expect(page.data.every(post => post.isLikedByViewer === false && post.isRepostedByViewer === false)).to.equal(true);
      expect(page.data.some(post => "_snapshotPosition" in post)).to.equal(false);
      const pipeline = aggregate.getCalls().map(call => call.args[0]).find(stages =>
        stages?.some(stage => "$lookup" in stage && stage.$lookup.from === "tags"));
      expect(pipeline).not.to.equal(undefined);
      const explanation = await Post.aggregate(pipeline!).explain("executionStats") as {
        stages: { $lookup?: unknown; nReturned?: number }[];
      };
      const lookup = explanation.stages.find(stage => stage.$lookup);
      expect(lookup).not.to.equal(undefined);
      expect(lookup!.nReturned).to.equal(11);
    } finally {
      aggregate.restore();
    }
  });

  it("fills pinned pages across missing and ineligible candidates without losing the lookahead", async () => {
    const posts = [...await addFormatPosts("TypeScript software", 65)].reverse();
    const definition = { topics: ["technology"], sort: "newest" as const, viewer: actor };
    const first = await dao.getInterestFeedWithCursor(definition, { limit: 10 });
    expect(first.data.map(post => post.publicId)).to.deep.equal(posts.slice(0, 10).map(post => post.publicId));
    const removed = [...posts.slice(10, 20), ...posts.slice(30, 62)];
    await Post.deleteMany({ _id: { $in: removed.map(post => post._id) } });
    await Post.collection.updateOne({ _id: posts[22]._id }, { $set: { contentFeatures: classifyContent("Finance", [], false) } });
    const expected = [...posts.slice(20, 22), ...posts.slice(23, 30), ...posts.slice(62)];
    const second = await dao.getInterestFeedWithCursor(definition, { limit: 10, cursor: first.nextCursor });
    expect(second.data.map(post => post.publicId)).to.deep.equal(expected.slice(0, 10).map(post => post.publicId));
    expect(second.hasMore).to.equal(true);
    expect(second.consumedOffset).to.equal(63);
    const last = await dao.getInterestFeedWithCursor(definition, { limit: 10, cursor: second.nextCursor });
    expect(last.data.map(post => post.publicId)).to.deep.equal(expected.slice(10).map(post => post.publicId));
    expect(last.hasMore).to.equal(false);
    expect(last.nextCursor).to.equal(undefined);
    expect([...first.data, ...second.data, ...last.data].map(post => post.publicId)).to.have.length(new Set(
      [...first.data, ...second.data, ...last.data].map(post => post.publicId)).size);
    await Post.deleteMany({ _id: { $in: expected.slice(10).map(post => post._id) } });
    const exhausted = await dao.getInterestFeedWithCursor(definition, { limit: 10, cursor: second.nextCursor });
    expect(exhausted.data).to.deep.equal([]);
    expect(exhausted.hasMore).to.equal(false);
    expect(exhausted.nextCursor).to.equal(undefined);
  });

  it("computes the documented normalized score and caps combined topic and popularity evidence", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    await Post.collection.updateOne({ _id: cryptoImage._id }, { $set: {
      createdAt: new Date("2026-10-15T12:00:00Z"), likesCount: 96, repostCount: 2,
      contentFeatures: { version: 1, format: "image", topics: [{ id: "crypto", weight: 0.6 }, { id: "finance", weight: 1 }] },
    } });
    const profile = { selected: ["finance"], topics: { crypto: 3, finance: 1 }, formats: { image: 3, text: 1 }, revision: 1 };
    const score = async () => (await Post.aggregate<{ rankScore: number }>([
      { $match: { _id: cryptoImage._id } }, ...buildInterestScoreStages(profile, now),
    ]))[0].rankScore;
    expect(await score()).to.be.closeTo(0.825, 1e-12);
    await Post.collection.updateOne({ _id: cryptoImage._id }, { $set: { likesCount: 10_000 } });
    expect(await score()).to.be.closeTo(0.825, 1e-12);
    await Post.collection.updateOne({ _id: cryptoImage._id }, { $set: {
      createdAt: new Date("2026-10-17T12:00:00Z"), likesCount: -2, repostCount: -1,
    }, $unset: { contentFeatures: "" } });
    expect(await score()).to.be.closeTo(0.3, 1e-12);
  });

  it("serves a majority of relevant images for image-heavy learning against keyword-rich prose", async () => {
    const imagePosts = [cryptoImage, ...await addFormatPosts("#crypto", 12, true)];
    const textPosts = [cryptoPost, ...await addFormatPosts("Ethereum blockchain", 12)];
    const mixedPosts = await addFormatPosts("Ethereum blockchain", 12, true);
    const unrelated = await addFormatPosts("#finance", 20, true);
    for (const post of [...imagePosts.slice(0, 8), cryptoPost, mixedPosts[0]]) {
      await likes.execute(new LikeActionByPublicIdCommand(actor, post.publicId));
    }
    const profile = await preferences.read(String(actorId));
    expect(profile.formats.image! / Object.values(profile.formats).reduce((sum, value) => sum + value, 0)).to.be.greaterThan(0.75);
    const feed = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    const ids = feed.data.map(post => post.publicId);
    expect(ids.filter(id => imagePosts.some(post => post.publicId === id))).to.have.length.of.at.least(6);
    expect(ids.some(id => textPosts.some(post => post.publicId === id))).to.equal(true);
    expect(ids.some(id => mixedPosts.some(post => post.publicId === id))).to.equal(true);
    expect(ids.filter(id => unrelated.some(post => post.publicId === id))).to.deep.equal([]);
    expect(ids).not.to.include(financePost.publicId);
  });

  it("keeps a format-mixed cursor pinned when new learning changes the preferred format", async () => {
    const imagePosts = [cryptoImage, ...await addFormatPosts("#crypto", 8, true)];
    const textPosts = await addFormatPosts("Ethereum blockchain", 12);
    await addFormatPosts("Ethereum blockchain", 5, true);
    for (const post of imagePosts.slice(0, 4)) await likes.execute(new LikeActionByPublicIdCommand(actor, post.publicId));
    const first = await forYou.execute(new GetForYouFeedQuery(actor, 1, 4));
    expect(imagePosts.map(post => post.publicId)).to.include(first.data[0].publicId);
    const second = await forYou.execute(new GetForYouFeedQuery(actor, 2, 4, first.nextCursor));
    for (const post of textPosts) await likes.execute(new LikeActionByPublicIdCommand(actor, post.publicId));
    const pinned = await forYou.execute(new GetForYouFeedQuery(actor, 2, 4, first.nextCursor));
    expect(pinned.data.map(post => [post.publicId, post.rankScore, post.feedReason])).to.deep.equal(second.data.map(post => [post.publicId, post.rankScore, post.feedReason]));
    expect(pinned.data.filter(post => first.data.some(previous => previous.publicId === post.publicId))).to.deep.equal([]);
    const fresh = await forYou.execute(new GetForYouFeedQuery(actor, 1, 4));
    expect(textPosts.map(post => post.publicId)).to.include(fresh.data[0].publicId);
    const seen = [...first.data, ...second.data].map(post => post.publicId);
    let cursor = second.nextCursor;
    while (cursor) {
      const page = await forYou.execute(new GetForYouFeedQuery(actor, 3, 4, cursor));
      seen.push(...page.data.map(post => post.publicId));
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).to.equal(seen.length);
    expect(seen).to.have.length(await Post.countDocuments());
  });

  it("does not promote unrelated images to fill a shortage of matching images", async () => {
    await addFormatPosts("Ethereum blockchain", 15);
    const unrelated = await addFormatPosts("#finance", 20, true);
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoImage.publicId));
    const feed = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    const ids = feed.data.map(post => post.publicId);
    expect(ids).to.include(cryptoImage.publicId);
    expect(ids.filter(id => [...unrelated, financePost].some(post => post.publicId === id))).to.deep.equal([]);
    expect(ids).to.have.length(10);
  });

  it("retains preferred image candidates beyond the global score cutoff", async () => {
    await addFormatPosts("Ethereum blockchain", MAX_FEED_CURSOR_SNAPSHOT_ITEMS + 1);
    const imagePosts = [cryptoImage, ...await addFormatPosts("#crypto", 12, true)];
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoImage.publicId));
    const feed = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    expect(feed.data.filter(post => imagePosts.some(image => image.publicId === post.publicId))).to.have.length.of.at.least(6);
    expect(feed.hasMore).to.equal(true);
  });

  it("orders Top by likes plus twice reposts within the selected topic", async () => {
    await Post.collection.updateOne({ _id: cryptoPost._id }, { $set: { likesCount: 8, repostCount: 0 } });
    await Post.collection.updateOne({ _id: cryptoImage._id }, { $set: { likesCount: 1, repostCount: 4 } });
    await Post.collection.updateOne({ _id: financePost._id }, { $set: { likesCount: 1_000 } });
    const top = await request(app).get("/api/feed/interests/posts?topics=crypto&sort=top").expect(200);
    expect(top.body.data.map((post: { publicId: string }) => post.publicId)).to.deep.equal([cryptoImage.publicId, cryptoPost.publicId]);
  });

  it("does not duplicate a contribution when the same active signal is recorded again", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await unit.executeInTransaction(() => preferences.setSignal(String(actorId), String(cryptoPost._id), "like", cryptoPost.contentFeatures!, true));
    }
    const signal = await FeedSignal.findOne({ userId: actorId }).orFail();
    expect(await FeedSignal.countDocuments({ userId: actorId })).to.equal(1);
    const profile = await preferences.read(String(actorId), signal.at);
    expect(profile.topics).to.deep.equal({ crypto: 3 });
    expect(profile.formats).to.deep.equal({ text: 3 });
  });

  it("pins pagination across preference changes and rejects a cursor from another viewer or interest", async () => {
    const page = await dao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: actor }, { limit: 1 });
    expect(page.nextCursor).to.be.a("string");
    await updates.execute(new UpdateInterestsCommand(actor, "select", ["crypto"]));
    const next = await dao.getInterestFeedWithCursor({ topics: [], sort: "personalized", viewer: actor, profile: await preferences.read(String(actorId)) }, { limit: 10, cursor: page.nextCursor });
    expect(next.data.map((post) => post.publicId)).not.to.include(page.data[0].publicId);
    for (const definition of [{ topics: [], sort: "personalized" as const, viewer: author }, { topics: ["crypto"], sort: "personalized" as const, viewer: actor }]) {
      const error = await dao.getInterestFeedWithCursor(definition, { limit: 10, cursor: page.nextCursor }).catch((reason: unknown) => reason);
      expect(error).to.be.instanceOf(AppError); expect((error as AppError).statusCode).to.equal(400);
    }
  });

  it("continues a version-one interest cursor after the classifier vocabulary changes", async () => {
    const definition = { topics: [], sort: "personalized" as const, viewer: actor };
    const first = await dao.getInterestFeedWithCursor(definition, { limit: 1 });
    const decoded = decodeFeedCursor(first.nextCursor!, { feed: "for-you", orders: [FEED_CURSOR_ORDER.FOR_YOU], source: "mongo" });
    const snapshots = new RedisFeedModule(redis as never);
    const snapshot = await snapshots.requireFeedCursorSnapshot(decoded.snapshotId, {
      feed: "for-you", order: FEED_CURSOR_ORDER.FOR_YOU, source: "mongo", scope: decoded.scope,
    });
    const legacyScope = hashFeedCursorScope(["interests-explained-v1", 1, "for-you", [], "personalized", actor]);
    const legacy = await snapshots.getOrCreateFeedCursorSnapshot(`${namespace}:legacy-classifier`, async () => ({ ...snapshot, scope: legacyScope }));
    const cursor = encodeFeedCursor({ ...decoded, snapshotId: legacy.id, scope: legacyScope });
    const next = await dao.getInterestFeedWithCursor(definition, { limit: 10, cursor });
    expect(next.data.map(post => [post.publicId, post.rankScore])).to.deep.equal(snapshot.entries.slice(1).map(entry => [entry.publicId, entry.score]));
    expect(next.data.map(post => post.publicId)).not.to.include(first.data[0].publicId);
    expect(next.hasMore).to.equal(false);
    const otherViewer = await dao.getInterestFeedWithCursor({ ...definition, viewer: author }, { limit: 10, cursor }).catch((error: unknown) => error);
    expect(otherViewer).to.be.instanceOf(AppError);
    expect((otherViewer as AppError).statusCode).to.equal(400);
  });

  it("learns ordinary reposts and removes that contribution when the repost is deleted", async () => {
    await reposts.execute(new RepostPostCommand(actor, cryptoPost.publicId));
    expect((await preferences.read(String(actorId))).topics.crypto).to.be.greaterThan(1.9);
    const feed = await forYou.execute(new GetForYouFeedQuery(actor, 1, 10));
    expect(feed.data.find((post) => post.publicId === cryptoPost.publicId || post.repostOf?.publicId === cryptoPost.publicId)?.isRepostedByViewer).to.equal(true);
    await unreposts.execute(new UnrepostPostCommand(actor, cryptoPost.publicId));
    expect((await preferences.read(String(actorId))).topics).to.deep.equal({});
    expect((await Post.findById(cryptoPost._id))?.repostCount).to.equal(0);
  });

  it("accepts an image-only quote through multipart validation without treating it as endorsement", async () => {
    const result = await request(app).post(`/api/posts/${cryptoPost.publicId}/repost`).set("Authorization", "Synthetic persona").attach("image", png, { filename: "meme.png", contentType: "image/png" }).expect(201);
    expect(result.body.image.url).to.equal("/synthetic/fixture.png");
    expect(result.body.body).to.equal("");
    expect(await FeedSignal.countDocuments()).to.equal(0);
    const all = await dao.getInterestFeedWithCursor({ topics: [], sort: "newest" }, { limit: 10 });
    expect(all.data.map((post) => post.publicId)).to.include.members([cryptoPost.publicId, result.body.publicId]);
    await unreposts.execute(new UnrepostPostCommand(actor, cryptoPost.publicId));
    expect(await Image.countDocuments({ user: actorId })).to.equal(0);
    expect(await OutboxModel.countDocuments({ "payload.storagePublicId": result.body.image.publicId })).to.equal(1);
  });

  it("persists image-only comments and nested replies, and deletes their attachment records durably", async () => {
    const result = await request(app).post(`/api/posts/${cryptoPost.publicId}/comments`).set("Authorization", "Synthetic persona").attach("image", png, { filename: "meme.png", contentType: "image/png" }).expect(201);
    expect(result.body.content).to.equal(""); expect(result.body.image.url).to.equal("/synthetic/fixture.png");
    await comments.execute(new CreateCommentCommand(actor, cryptoPost.publicId, "", result.body.id, png, "image/png", "reply.png"));
    await deleteComments.execute(new DeleteCommentCommand(result.body.id, actor));
    expect((await Comment.findById(result.body.id))?.isDeleted).to.equal(true);
    expect(await Image.countDocuments({ user: actorId })).to.equal(1);
    expect(await OutboxModel.countDocuments({ "payload.storagePublicId": result.body.image.publicId })).to.equal(1);
    expect(await FeedSignal.countDocuments()).to.equal(0);
  });

  it("rejects empty comments and disguised uploads without creating attachments", async () => {
    await request(app).post(`/api/posts/${cryptoPost.publicId}/comments`).set("Authorization", "Synthetic persona").send({ content: "" }).expect(400);
    await request(app).post(`/api/posts/${cryptoPost.publicId}/comments`).set("Authorization", "Synthetic persona").attach("image", Buffer.from("not an image"), { filename: "fake.png", contentType: "image/png" }).expect(400);
    expect(await Image.countDocuments({ user: actorId })).to.equal(0); expect(await Comment.countDocuments()).to.equal(0);
  });

  it("compensates an uploaded asset after rollback while preserving the original failure", async () => {
    const user = await User.findById(actorId);
    const error = await attachments.run({ imageBuffer: png, imageMimeType: "image/png" }, user!, async () => { throw new Error("write rejected"); }).catch((reason: unknown) => reason);
    expect((error as Error).message).to.equal("write rejected");
    expect(await Image.countDocuments({ user: actorId })).to.equal(0); expect(deletedAssets).to.have.length(1);
    expect(await OutboxModel.countDocuments({ "payload.storagePublicId": deletedAssets[0] })).to.equal(1);
  });

  it("backfills existing prose and hashtags explicitly and is idempotent", async () => {
    await Post.updateMany({}, { $unset: { contentFeatures: 1 } });
    expect(await backfillContentFeatures(Post, Tag, false)).to.equal(3);
    expect(await Post.countDocuments({ contentFeatures: { $exists: true } })).to.equal(0);
    expect(await backfillContentFeatures(Post, Tag, true)).to.equal(3);
    expect(await backfillContentFeatures(Post, Tag, true)).to.equal(0);
    expect((await Post.findById(cryptoPost._id))?.contentFeatures?.topics.map((topic) => topic.id)).to.deep.equal(["crypto"]);
  });

  it("reclassifies old content without rewriting captured feedback and learns new forms on a new like", async () => {
    await Post.collection.updateOne({ _id: cryptoPost._id }, { $set: { body: "Investments in software",
      contentFeatures: { version: 1, format: "text", topics: [{ id: "technology", weight: 0.6 }] } } });
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    const original = await FeedSignal.findOne({ userId: actorId, postId: cryptoPost._id }).lean().orFail();
    const revision = (await preferences.read(String(actorId), original.at)).revision;
    const outboxCount = await OutboxModel.countDocuments();
    expect(await backfillContentFeatures(Post, Tag, false)).to.equal(1);
    expect((await Post.findById(cryptoPost._id))?.contentFeatures?.version).to.equal(1);
    expect(await backfillContentFeatures(Post, Tag, true)).to.equal(1);
    expect(await backfillContentFeatures(Post, Tag, true)).to.equal(0);
    expect((await Post.findById(cryptoPost._id))?.contentFeatures).to.deep.include({ version: 2, format: "text" });
    const retained = await FeedSignal.findById(original._id).lean().orFail();
    expect(retained.features).to.deep.equal(original.features);
    expect(retained.at).to.deep.equal(original.at);
    const unchanged = await preferences.read(String(actorId), original.at);
    expect(unchanged.topics).to.deep.equal({ technology: 3 * 0.6 });
    expect(unchanged.revision).to.equal(revision);
    expect(await OutboxModel.countDocuments()).to.equal(outboxCount);
    const topicFeed = await dao.getInterestFeedWithCursor({ topics: ["finance"], sort: "newest" }, { limit: 10 });
    expect(topicFeed.data.map(post => post.publicId)).to.include(cryptoPost.publicId);
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    expect(await FeedSignal.countDocuments({ userId: actorId })).to.equal(0);
    await likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId));
    const current = await FeedSignal.findOne({ userId: actorId, postId: cryptoPost._id }).lean().orFail();
    expect(current.features.version).to.equal(2);
    expect((await preferences.read(String(actorId), current.at)).topics).to.deep.equal({ finance: 3 * 0.6, technology: 3 * 0.6 });
  });

  it("preserves an attachment when transaction commit acknowledgement is unresolved", async () => {
    const ambiguous = new AmbiguousTransactionCommitError(1, new Error("acknowledgement lost"));
    const unresolved = new AttachmentTransactionService(images, {
      executeInTransaction: async (write: () => Promise<unknown>) => { await unit.executeInTransaction(write); throw ambiguous; },
    } as never, events);
    const user = await User.findById(actorId);
    const error = await unresolved.run({ imageBuffer: png, imageMimeType: "image/png" }, user!, async () => undefined).catch((reason: unknown) => reason);
    expect(error).to.equal(ambiguous);
    expect(await Image.countDocuments({ user: actorId })).to.equal(1);
    expect(deletedAssets).to.deep.equal([]);
    expect(await OutboxModel.countDocuments()).to.equal(0);
  });

  it("requires standalone images to have text or a tag before any upload is persisted", async () => {
    await request(app).post("/api/posts").set("Authorization", "Synthetic persona")
      .attach("image", png, { filename: "empty.png", contentType: "image/png" }).expect(400);
    expect(await Post.countDocuments()).to.equal(3); expect(await Image.countDocuments({ user: actorId })).to.equal(0);
    await request(app).post("/api/posts").set("Authorization", "Synthetic persona").field("tags", "malformed")
      .attach("image", png, { filename: "invalid-tags.png", contentType: "image/png" }).expect(400);
    expect(await Post.countDocuments()).to.equal(3); expect(await Image.countDocuments({ user: actorId })).to.equal(0);
    const tagged = await request(app).post("/api/posts").set("Authorization", "Synthetic persona")
      .field("tags", JSON.stringify(["crypto"]))
      .attach("image", png, { filename: "tagged.png", contentType: "image/png" }).expect(201);
    const stored = await Post.findOne({ publicId: tagged.body.publicId });
    expect(stored?.status).to.equal("active");
    expect(stored?.contentFeatures?.format).to.equal("image");
    expect(stored?.contentFeatures?.topics.map((topic) => ({ id: topic.id, weight: topic.weight }))).to.deep.equal([{ id: "crypto", weight: 0.2 }]);
  });

  it("does not lose preferences when a new account likes different posts concurrently", async () => {
    await Promise.all([likes.execute(new LikeActionByPublicIdCommand(actor, cryptoPost.publicId)), likes.execute(new LikeActionByPublicIdCommand(actor, financePost.publicId))]);
    expect(await FeedSignal.countDocuments({ userId: actorId })).to.equal(2);
    const profile = await preferences.read(String(actorId));
    expect(profile.topics.crypto).to.be.greaterThan(2.9); expect(profile.topics.finance).to.be.greaterThan(2.9);
    expect(await PostLike.countDocuments({ userId: actorId })).to.equal(2);
  });

  it("keeps recommendation explanations with the snapshot that produced them", async () => {
    await updates.execute(new UpdateInterestsCommand(actor, "select", ["finance"]));
    const first = await forYou.execute(new GetForYouFeedQuery(actor, 1, 1));
    expect(first.data[0].publicId).to.equal(financePost.publicId);
    expect(first.data[0].feedReason).to.equal("chosen:finance");
    await updates.execute(new UpdateInterestsCommand(actor, "select", ["crypto"]));
    const next = await forYou.execute(new GetForYouFeedQuery(actor, 2, 10, first.nextCursor));
    expect(next.data.map((post) => post.publicId)).to.have.members([cryptoPost.publicId, cryptoImage.publicId]);
    expect(next.data.map((post) => post.feedReason)).to.deep.equal(["activity", "activity"]);
  });
});
