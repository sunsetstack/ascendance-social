import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import mongoose, { Types } from "mongoose";
import { RecordPostViewCommand } from "@/application/commands/post/recordPostView/recordPostView.command";
import { RecordPostViewCommandHandler } from "@/application/commands/post/recordPostView/recordPostView.handler";
import { UnitOfWork } from "@/database/UnitOfWork";
import Post from "@/models/post.model";
import PostView from "@/models/postView.model";
import { PostViewRepository } from "@/repositories/postView.repository";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { asPostPublicId, asUserPublicId } from "@/types/branded";

const mongoUri = process.env.INTEGRATION_MONGODB_URI;
const databaseName = `ascendance_view_regression_${randomUUID().replaceAll("-", "")}`;

(mongoUri ? describe : describe.skip)("Post view transaction persistence", function () {
  this.timeout(30_000);
  const postPublicId = asPostPublicId(randomUUID());
  const viewerPublicId = asUserPublicId(randomUUID());
  const viewerId = new Types.ObjectId();
  const authorId = new Types.ObjectId();
  let postId: Types.ObjectId;
  let unitOfWork: UnitOfWork;
  let writes: PostWriteRepository;
  let metadataUpdates: number;

  before(async () => {
    if (!mongoUri!.startsWith("mongodb://127.0.0.1:")) {
      throw new Error("View regressions require an isolated local MongoDB replica set");
    }
    await mongoose.connect(mongoUri!, { dbName: databaseName, serverSelectionTimeoutMS: 5_000 });
    await Post.init();
    await PostView.init();
    unitOfWork = new UnitOfWork();
    writes = new PostWriteRepository(Post);
  });

  beforeEach(async () => {
    await PostView.deleteMany({});
    await Post.deleteMany({});
    metadataUpdates = 0;
    const post = await Post.create({
      publicId: postPublicId,
      user: authorId,
      author: { _id: authorId, publicId: randomUUID(), handle: "author", username: "Author" },
      body: "View transaction regression",
    });
    postId = post._id as Types.ObjectId;
  });

  after(async () => {
    if (mongoose.connection.name === databaseName) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  });

  function handler(
    postWrites = writes,
    viewer = { _id: viewerId, publicId: viewerPublicId },
  ): RecordPostViewCommandHandler {
    return new RecordPostViewCommandHandler(
      { findOneByPublicId: () => Post.findOne({ publicId: postPublicId }) } as never,
      postWrites,
      new PostViewRepository(),
      { findByPublicId: async () => viewer } as never,
      {} as never,
      {
        registerHandler: () => undefined,
        executeOrQueue: async () => { metadataUpdates += 1; },
      } as never,
      { mightContain: async () => false, add: async () => undefined } as never,
      unitOfWork,
    );
  }

  const command = () => new RecordPostViewCommand(postPublicId, viewerPublicId);

  async function expectSingleView(): Promise<void> {
    expect(await PostView.countDocuments({ post: postId, user: viewerId })).to.equal(1);
    expect((await Post.findById(postId))?.viewsCount).to.equal(1);
    expect(metadataUpdates).to.equal(1);
  }

  it("records the first view and its count atomically", async () => {
    expect(await handler().execute(command())).to.equal(true);
    await expectSingleView();
  });

  it("commits repeated views after Bloom misses without retrying an aborted transaction", async () => {
    const recorder = handler();
    expect(await recorder.execute(command())).to.equal(true);
    expect(await recorder.execute(command())).to.equal(false);
    expect(await recorder.execute(command())).to.equal(false);
    await expectSingleView();
  });

  it("counts one view when concurrent requests miss Bloom", async () => {
    const recorder = handler();
    const results = await Promise.all(Array.from({ length: 8 }, () => recorder.execute(command())));
    expect(results.filter(Boolean)).to.have.length(1);
    await expectSingleView();
  });

  it("counts every distinct concurrent viewer without losing transaction retries", async () => {
    const viewers = Array.from({ length: 8 }, () => ({
      _id: new Types.ObjectId(), publicId: asUserPublicId(randomUUID()),
    }));
    const results = await Promise.allSettled(viewers.map((viewer) =>
      handler(writes, viewer).execute(new RecordPostViewCommand(postPublicId, viewer.publicId)),
    ));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      expect(result.value).to.equal(true);
    }
    expect(await PostView.countDocuments({ post: postId })).to.equal(viewers.length);
    expect((await Post.findById(postId))?.viewsCount).to.equal(viewers.length);
    expect(metadataUpdates).to.equal(viewers.length);
  });

  it("rolls back the view when its counter write fails and permits a later retry", async () => {
    const failingWrites = {
      incrementViewCount: async () => { throw new Error("counter unavailable"); },
    } as never;
    let failure: unknown;
    try {
      await handler(failingWrites).execute(command());
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(Error);
    expect(await PostView.countDocuments({ post: postId })).to.equal(0);
    expect((await Post.findById(postId))?.viewsCount).to.equal(0);
    expect(metadataUpdates).to.equal(0);
    expect(await handler().execute(command())).to.equal(true);
    await expectSingleView();
  });
});
