import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import { RecordPostViewCommandHandler } from "@/application/commands/post/recordPostView/recordPostView.handler";
import { RecordPostViewCommand } from "@/application/commands/post/recordPostView/recordPostView.command";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { FeedService } from "@/services/feed/feed.service";
import { PostViewRepository } from "@/repositories/postView.repository";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";

describe("RecordPostViewCommandHandler", () => {
  let handler: RecordPostViewCommandHandler;
  let postReadRepoStub: any;
  let postWriteRepoStub: any;
  let postViewRepoStub: any;
  let userReadRepoStub: any;
  let feedServiceStub: any;
  let transactionQueueStub: any;
  let bloomFilterServiceStub: any;

  const postId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  // use valid UUID v4 format for publicIds
  const postPublicId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const userPublicId = "f1e2d3c4-b5a6-4978-8d9e-0f1a2b3c4d5e";

  beforeEach(() => {
    postReadRepoStub = {
      findOneByPublicId: sinon.stub(),
    };
    postWriteRepoStub = {
      incrementViewCount: sinon.stub().resolves(),
    };
    postViewRepoStub = sinon.createStubInstance(PostViewRepository);
    userReadRepoStub = {
      findByPublicId: sinon.stub(),
    };
    feedServiceStub = sinon.createStubInstance(FeedService);
    transactionQueueStub = sinon.createStubInstance(TransactionQueueService);
    bloomFilterServiceStub = sinon.createStubInstance(BloomFilterService);

    // Default successful mocks
    postReadRepoStub.findOneByPublicId.resolves({
      _id: postId,
      publicId: postPublicId,
      user: new mongoose.Types.ObjectId(), // Different user (owner)
      viewsCount: 10,
    });

    userReadRepoStub.findByPublicId.resolves({
      _id: userId,
      publicId: userPublicId,
    });

    postViewRepoStub.recordView.resolves(true); // New view
    bloomFilterServiceStub.mightContain.resolves(false);
    bloomFilterServiceStub.add.resolves();

    transactionQueueStub.executeOrQueue.resolves();

    handler = new RecordPostViewCommandHandler(
      postReadRepoStub,
      postWriteRepoStub,
      postViewRepoStub,
      userReadRepoStub,
      feedServiceStub,
      transactionQueueStub,
      bloomFilterServiceStub,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should record a new view and queue view count increment", async () => {
    const command = new RecordPostViewCommand(postPublicId, userPublicId);

    const result = await handler.execute(command);

    expect(result).to.be.true;
    expect(postViewRepoStub.recordView.calledWith(postId, userId)).to.be.true;
    expect(bloomFilterServiceStub.add.calledOnce).to.be.true;

    // Verify transaction queue usage
    expect(transactionQueueStub.executeOrQueue.calledOnce).to.be.true;
    const args = transactionQueueStub.executeOrQueue.firstCall.args;
    expect(args[1]).to.deep.include({ priority: "low", loadThreshold: 30 });
  });

  it("should not increment view count if view is not new", async () => {
    postViewRepoStub.recordView.resolves(false); // Not a new view

    const command = new RecordPostViewCommand(postPublicId, userPublicId);

    const result = await handler.execute(command);

    expect(result).to.be.false;
    expect(transactionQueueStub.executeOrQueue.called).to.be.false;
    expect(bloomFilterServiceStub.add.calledOnce).to.be.true;
  });

  it("should short-circuit when bloom filter indicates the user has already viewed the post", async () => {
    bloomFilterServiceStub.mightContain.resolves(true);

    const command = new RecordPostViewCommand(postPublicId, userPublicId);
    const result = await handler.execute(command);

    expect(result).to.be.false;
    expect(postViewRepoStub.recordView.called).to.be.false;
    expect(transactionQueueStub.executeOrQueue.called).to.be.false;
  });

  it("should throw error if post not found", async () => {
    postReadRepoStub.findOneByPublicId.resolves(null);

    const command = new RecordPostViewCommand(postPublicId, userPublicId);

    try {
      await handler.execute(command);
      expect.fail("Should have thrown error");
    } catch (error: any) {
      expect(error.name).to.equal("PostNotFoundError");
    }
  });

  it("should throw error if user not found", async () => {
    userReadRepoStub.findByPublicId.resolves(null);

    const command = new RecordPostViewCommand(postPublicId, userPublicId);

    try {
      await handler.execute(command);
      expect.fail("Should have thrown error");
    } catch (error: any) {
      expect(error.name).to.equal("UserNotFoundError");
    }
  });

  it("should return false if user is owner", async () => {
    postReadRepoStub.findOneByPublicId.resolves({
      _id: postId,
      publicId: postPublicId,
      user: userId, // Same user
      viewsCount: 10,
    });

    const command = new RecordPostViewCommand(postPublicId, userPublicId);

    const result = await handler.execute(command);

    expect(result).to.be.false;
  });
});
