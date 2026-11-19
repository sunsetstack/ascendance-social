import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import Post from "@/models/post.model";
import PostLike from "@/models/postLike.model";
import { OutboxModel } from "@/models/outbox.model";
import { UnitOfWork } from "@/database/UnitOfWork";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { PostReadRepository } from "@/repositories/read/PostReadRepository";
import { PostCountersRepository } from "@/repositories/read/PostCountersRepository";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { PostLikeCountReconciledHandler } from "@/application/events/post/post-like-count-reconciled.handler";
import {
  PostLikeCountReconciledEvent,
  PostViewRecordedEvent,
} from "@/application/events/post/post.event";
import { PostViewRecordedHandler } from "@/application/events/post/post-view-recorded.handler";
import { EventBus } from "@/application/common/buses/event.bus";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { MetricsService } from "@/metrics/metrics.service";
import { TestableOutboxWorker } from "../helpers/outbox-fixtures";
import { asMongoId, asPostPublicId } from "@/types/branded";

const uri = process.env.INTEGRATION_MONGODB_URI;
(uri ? describe : describe.skip)("Authoritative post counters", function () {
  this.timeout(30_000);
  const publicId = asPostPublicId(randomUUID());
  let postId: Types.ObjectId;
  let unit: UnitOfWork;
  let writes: PostWriteRepository;
  before(async () => {
    await mongoose.connect(uri!, {
      dbName: `ascendance_counter_order_${randomUUID().replaceAll("-", "")}`,
    });
    await Promise.all([Post.init(), PostLike.init(), OutboxModel.init()]);
    unit = new UnitOfWork();
    writes = new PostWriteRepository(Post);
  });
  beforeEach(async () => {
    await Promise.all([
      Post.deleteMany({}),
      PostLike.deleteMany({}),
      OutboxModel.deleteMany({}),
    ]);
    const author = new Types.ObjectId();
    const post = await Post.create({
      publicId,
      user: author,
      body: "Counters",
      author: {
        _id: author,
        publicId: randomUUID(),
        handle: "author",
        username: "Author",
      },
    });
    postId = post._id as Types.ObjectId;
  });
  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("increments the revision for each like transition and returns current counts in request order", async () => {
    for (const delta of [1, -1, 1])
      await unit.executeInTransaction(() =>
        writes.updateLikeCount(asMongoId(String(postId)), delta),
      );
    const values = await new PostCountersRepository(Post).getPostMetadata([
      publicId,
      randomUUID(),
      publicId,
    ]);
    expect(values[0]).to.include({
      likes: 1,
      likesRevision: 3,
      viewsCount: 0,
      commentsCount: 0,
    });
    expect(values[1]).to.equal(null);
    expect(values[2]).to.deep.equal(values[0]);
  });

  it("rolls the revision back together with a failed counter write", async () => {
    let failure: unknown;
    try {
      await unit.executeInTransaction(async () => {
        await writes.updateLikeCount(asMongoId(String(postId)), 1);
        throw new Error("abort counter mutation");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(Error);
    expect(await Post.findById(postId).lean().orFail()).to.include({
      likesCount: 0,
      likesRevision: 0,
    });
  });

  it("advances the revision on reconciliation and publishes current state for an older event", async () => {
    await Post.updateOne(
      { _id: postId },
      { $set: { likesCount: 5, likesRevision: 2 } },
    );
    await PostLike.create({ postId, userId: new Types.ObjectId() });
    await unit.executeInTransaction(() =>
      new ContentCleanupService(Post).recomputePostLikeCounts([postId]),
    );
    const publish = sinon.stub().resolves();
    const handler = new PostLikeCountReconciledHandler(
      new FeedMetaService({ publish } as never),
      new PostReadRepository(Post),
    );
    await handler.handle(new PostLikeCountReconciledEvent(publicId, 5));
    const message = JSON.parse(publish.firstCall.args[1]);
    expect(message).to.include({ newLikes: 1, likesRevision: 3 });
  });

  it("acknowledges already queued view-cache jobs without requiring a cache writer", async () => {
    const metrics = sinon.createStubInstance(MetricsService);
    const outbox = new OutboxRepository(OutboxModel);
    const events = new EventBus(outbox, metrics);
    events.subscribe(PostViewRecordedEvent, new PostViewRecordedHandler());
    await events.queueDurable(new PostViewRecordedEvent(publicId));
    await new TestableOutboxWorker(outbox, events, metrics).runTick();
    expect((await OutboxModel.findOne().orFail()).processed).to.equal(true);
  });
});
