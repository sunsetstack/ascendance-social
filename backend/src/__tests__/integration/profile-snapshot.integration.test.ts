import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import User from "@/models/user.model";
import Post from "@/models/post.model";
import UserAction from "@/models/userAction.model";
import { OutboxModel } from "@/models/outbox.model";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { UserWriteRepository } from "@/repositories/write/UserWriteRepository";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import Follow from "@/models/follow.model";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserProfileSnapshotSyncHandler } from "@/application/events/user/user-profile-snapshot-sync.handler";
import {
  UserAvatarChangedEvent,
  UserUsernameChangedEvent,
} from "@/application/events/user/user-interaction.event";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { UpdateProfileCommandHandler } from "@/application/commands/users/updateProfile/updateProfile.handler";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { MetricsService } from "@/metrics/metrics.service";
import { DTOService } from "@/services/dto.service";
import { TestableOutboxWorker } from "../helpers/outbox-fixtures";
import { asMongoId, asUserPublicId } from "@/types/branded";

const uri = process.env.INTEGRATION_MONGODB_URI;

(uri ? describe : describe.skip)("Durable profile snapshots", function () {
  this.timeout(30_000);
  const userId = new Types.ObjectId();
  const publicId = asUserPublicId(randomUUID());
  let users: UserReadRepository;
  let writes: UserWriteRepository;
  let posts: PostWriteRepository;
  let outbox: OutboxRepository;
  let events: EventBus;
  let metrics: sinon.SinonStubbedInstance<MetricsService>;
  let unit: UnitOfWork;

  before(async () => {
    await mongoose.connect(uri!, {
      dbName: `ascendance_profile_${randomUUID().replaceAll("-", "")}`,
    });
    await Promise.all([
      User.init(),
      Post.init(),
      UserAction.init(),
      OutboxModel.init(),
    ]);
    users = new UserReadRepository(User, new FollowRepository(Follow));
    writes = new UserWriteRepository(User);
    posts = new PostWriteRepository(Post);
    outbox = new OutboxRepository(OutboxModel);
    unit = new UnitOfWork();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Post.deleteMany({}),
      UserAction.deleteMany({}),
      OutboxModel.deleteMany({}),
    ]);
    await User.collection.insertOne({
      _id: userId,
      publicId,
      username: "Original",
      handle: "profile-author",
      handleNormalized: "profile-author",
      email: "profile@example.com",
      avatar: "old-avatar",
      isBanned: false,
    });
    metrics = sinon.createStubInstance(MetricsService);
    events = new EventBus(outbox, metrics);
    const handler = new UserProfileSnapshotSyncHandler(users, posts);
    events.subscribe(UserUsernameChangedEvent, handler);
    events.subscribe(UserAvatarChangedEvent, handler);
    events.subscribe(PostUploadedEvent, handler);
  });

  afterEach(() => sinon.restore());
  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  async function createPosts(count: number): Promise<void> {
    await Post.insertMany(
      Array.from({ length: count }, () => ({
        publicId: randomUUID(),
        user: userId,
        type: "original",
        status: "active",
        tags: [],
        author: {
          _id: userId,
          publicId,
          handle: "profile-author",
          username: "Original",
          avatarUrl: "old-avatar",
        },
      })),
    );
    await Post.collection.updateMany(
      {},
      { $unset: { "author.profileRevision": "" } },
    );
  }

  it("commits profile work without a subscriber and completes it after restarting delivery", async () => {
    await createPosts(2);
    const command = new UpdateProfileCommandHandler(
      users,
      writes,
      unit,
      new UserActionRepository(UserAction),
      new DTOService(),
      events,
    );
    await command.execute(
      new UpdateProfileCommand(publicId, { username: "Current" }),
    );
    expect((await User.findById(userId).orFail()).profileRevision).to.equal(1);
    expect(
      await Post.countDocuments({ "author.username": "Original" }),
    ).to.equal(2);
    expect(await OutboxModel.countDocuments({ processed: false })).to.equal(1);

    await new TestableOutboxWorker(outbox, events, metrics).runTick();
    expect(
      await Post.countDocuments({
        "author.username": "Current",
        "author.displayName": "Current",
        "author.profileRevision": 1,
      }),
    ).to.equal(2);
    expect(
      (await OutboxModel.findOne().orFail()).processedHandlers,
    ).to.deep.equal(["UserProfileSnapshotSyncHandler"]);
  });

  it("retries an interrupted multi-batch projection without acknowledging it early", async () => {
    await createPosts(502);
    await unit.executeInTransaction(async () => {
      await writes.updateAvatar(asMongoId(userId.toString()), "current-avatar");
      await events.queueTransactional(
        new UserAvatarChangedEvent(publicId, "old-avatar", "current-avatar"),
      );
    });
    const update = sinon.stub(Post.collection, "updateMany").callThrough();
    update.onSecondCall().rejects(new Error("interrupted projection"));
    await new TestableOutboxWorker(outbox, events, metrics).runTick();
    const interrupted = await OutboxModel.findOne().orFail();
    expect(interrupted.processed).to.equal(false);
    expect(interrupted.processedHandlers).to.deep.equal([]);
    expect(
      await Post.countDocuments({ "author.avatarUrl": "current-avatar" }),
    ).to.equal(500);
    const completed = await Post.findOne({
      "author.profileRevision": 1,
    }).orFail();
    update.restore();
    await OutboxModel.updateOne({}, { $unset: { nextAttemptAt: "" } });

    await new TestableOutboxWorker(outbox, events, metrics).runTick();
    expect(
      await Post.countDocuments({
        "author.avatarUrl": "current-avatar",
        "author.profileRevision": 1,
      }),
    ).to.equal(502);
    expect((await OutboxModel.findOne().orFail()).processed).to.equal(true);
    expect(
      (await Post.findById(completed._id).orFail()).updatedAt,
    ).to.deep.equal(completed.updatedAt);
  });

  it("loads current values for old events and prevents an overlapping older write from regressing them", async () => {
    await createPosts(2);
    await User.updateOne(
      { _id: userId },
      { $set: { username: "First", profileRevision: 1 } },
    );
    let release!: () => void;
    let started!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const original = posts.updateAuthorSnapshot.bind(posts);
    sinon.stub(posts, "updateAuthorSnapshot").callsFake(async (...args) => {
      started();
      await paused;
      return original(...args);
    });
    const older = new UserProfileSnapshotSyncHandler(users, posts).handle(
      new UserUsernameChangedEvent(publicId, "Original", "Stale event value"),
    );
    await ready;
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          username: "Latest",
          avatar: "latest-avatar",
          profileRevision: 2,
        },
      },
    );
    await new UserProfileSnapshotSyncHandler(
      users,
      new PostWriteRepository(Post),
    ).handle(
      new UserAvatarChangedEvent(publicId, "old-avatar", "Stale avatar value"),
    );
    release();
    await older;
    expect(
      await Post.countDocuments({
        "author.username": "Latest",
        "author.avatarUrl": "latest-avatar",
        "author.profileRevision": 2,
      }),
    ).to.equal(2);
  });

  it("repairs a post inserted from an old profile after the profile fan-out has finished", async () => {
    await User.updateOne(
      { _id: userId },
      { $set: { username: "Latest", profileRevision: 3 } },
    );
    const handler = new UserProfileSnapshotSyncHandler(users, posts);
    await handler.handle(
      new UserUsernameChangedEvent(publicId, "Original", "Latest"),
    );
    await createPosts(1);
    const post = await Post.findOne().orFail();
    await handler.handle(new PostUploadedEvent(post.publicId, publicId, []));
    expect((await Post.findById(post._id).orFail()).author).to.include({
      username: "Latest",
      profileRevision: 3,
    });
  });
});
