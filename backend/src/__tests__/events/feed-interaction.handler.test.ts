import "reflect-metadata";
import { describe, it, beforeEach, afterEach } from "mocha";
import { container } from "tsyringe";
import { expect } from "chai";
import * as sinon from "sinon";
import { FeedInteractionHandler } from "@/application/events/user/feed-interaction.handler";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import { FeedInteractionService } from "@/services/feed/feed-interaction.service";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { RedisService } from "@/services/redis.service";
import { IPost } from "@/types";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { asPostPublicId, asUserPublicId } from "@/types/branded";

const ACTOR_PUBLIC_ID = asUserPublicId("user123");
const POST_PUBLIC_ID = asPostPublicId("postABC");
const OWNER_PUBLIC_ID = asUserPublicId("owner456");

describe("FeedInteractionHandler", () => {
  let handler: FeedInteractionHandler;
  let feedInteractionServiceMock: sinon.SinonStubbedInstance<FeedInteractionService>;
  let feedMetaServiceMock: sinon.SinonStubbedInstance<FeedMetaService>;
  let redisServiceMock: sinon.SinonStubbedInstance<RedisService>;
  let userRepositoryMock: {
    findByPublicId: sinon.SinonStub;
    findUsersFollowing: sinon.SinonStub;
  };
  let postRepositoryMock: {
    findByPublicId: sinon.SinonStub;
  };

  beforeEach(() => {
    // Create stubs for all dependencies
    feedInteractionServiceMock = sinon.createStubInstance(FeedInteractionService);
    feedMetaServiceMock = sinon.createStubInstance(FeedMetaService);
    redisServiceMock = sinon.createStubInstance(RedisService);
    userRepositoryMock = {
      findByPublicId: sinon.stub().resolves({ isBanned: false }),
      findUsersFollowing: sinon.stub(),
    };
    postRepositoryMock = {
      findByPublicId: sinon.stub().resolves({
        publicId: POST_PUBLIC_ID,
        likesCount: 0,
      }),
    };

    // Register mocks in the DI container
    container.register("FeedInteractionService", { useValue: feedInteractionServiceMock });
    container.register("FeedMetaService", { useValue: feedMetaServiceMock });
    container.register("RedisService", { useValue: redisServiceMock });
    container.register("UserReadRepository", {
      useValue: userRepositoryMock as unknown as IUserReadRepository,
    });
    container.register("PostReadRepository", {
      useValue: postRepositoryMock as unknown as IPostReadRepository,
    });

    // Resolve the handler with mocked dependencies
    handler = container.resolve(FeedInteractionHandler);
  });

  afterEach(() => {
    sinon.restore();
    container.clearInstances();
  });

  it("records a like and updates metadata without structural cache invalidation", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent(ACTOR_PUBLIC_ID, "like", POST_PUBLIC_ID, ["tag1"], OWNER_PUBLIC_ID);
    const mockPost = { publicId: "postABC", likesCount: 10 } as IPost;

    postRepositoryMock.findByPublicId.resolves(mockPost);
    feedInteractionServiceMock.recordInteraction.resolves();
    feedMetaServiceMock.updatePostLikeMeta.resolves();
    redisServiceMock.invalidateByTags.resolves();
    redisServiceMock.pushToStream.resolves();
    redisServiceMock.publish.resolves();

    // Act
    await handler.handle(event);

    // Assert
    // 1. It should record the base interaction
    expect(feedInteractionServiceMock.recordInteraction.calledOnceWith("user123", "like", "postABC", ["tag1"])).to.be.true;

    // 2. It should update the post's like metadata cache
    expect(postRepositoryMock.findByPublicId.calledOnceWith("postABC")).to.be.true;
    expect(feedMetaServiceMock.updatePostLikeMeta.calledOnceWith("postABC", 10)).to.be.true;

    expect(redisServiceMock.invalidateByTags.called).to.be.false;

    expect(userRepositoryMock.findUsersFollowing.called).to.be.false;
  });

  it("records a comment and writes its interaction stream event", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent(ACTOR_PUBLIC_ID, "comment", POST_PUBLIC_ID, ["tag1"], OWNER_PUBLIC_ID);

    feedInteractionServiceMock.recordInteraction.resolves();
    redisServiceMock.invalidateByTags.resolves();
    redisServiceMock.pushToStream.resolves();
    redisServiceMock.publish.resolves();

    // Act
    await handler.handle(event);

    // Assert
    // 1. It should record the base interaction
    expect(feedInteractionServiceMock.recordInteraction.calledOnceWith("user123", "comment", "postABC", ["tag1"])).to.be.true;

    // 2. It should NOT update like meta for a comment
    expect(feedMetaServiceMock.updatePostLikeMeta.called).to.be.false;

    expect(redisServiceMock.pushToStream.calledOnce).to.be.true;
    expect(redisServiceMock.invalidateByTags.called).to.be.false;
  });

  it("should throw an error if recordInteraction fails", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent(ACTOR_PUBLIC_ID, "like", POST_PUBLIC_ID, [], OWNER_PUBLIC_ID);
    const testError = new Error("Database connection lost");
    feedInteractionServiceMock.recordInteraction.rejects(testError);

    // Act & Assert
    try {
      await handler.handle(event);
      // If it doesn't throw, the test should fail
      expect.fail("Handler did not throw an error as expected.");
    } catch (error: any) {
      expect(error).to.equal(testError);
      expect(error.message).to.equal("Database connection lost");
    }

    // Ensure it doesn't proceed to invalidation steps on failure
    expect(redisServiceMock.invalidateByTags.called).to.be.false;
  });

  it("skips a delayed interaction after the actor is unavailable", async () => {
    userRepositoryMock.findByPublicId.resolves(null);
    const event = new UserInteractedWithPostEvent(
      ACTOR_PUBLIC_ID,
      "like",
      POST_PUBLIC_ID,
      [],
      OWNER_PUBLIC_ID,
    );

    await handler.handle(event);

    expect(feedInteractionServiceMock.recordInteraction.called).to.be.false;
    expect(redisServiceMock.pushToStream.called).to.be.false;
  });
});
