import "reflect-metadata";
import { describe, it, beforeEach, afterEach } from "mocha";
import { container } from "tsyringe";
import { expect } from "chai";
import * as sinon from "sinon";
import { FeedInteractionHandler } from "@/application/events/user/feed-interaction.handler";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import { FeedService } from "@/services/feed/feed.service";
import { RedisService } from "@/services/redis.service";
import { UserRepository } from "@/repositories/user.repository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { PostRepository } from "@/repositories/post.repository";
import { IPost } from "@/types";

describe("FeedInteractionHandler", () => {
  let handler: FeedInteractionHandler;
  let feedServiceMock: sinon.SinonStubbedInstance<FeedService>;
  let redisServiceMock: sinon.SinonStubbedInstance<RedisService>;
  let userRepositoryMock: sinon.SinonStubbedInstance<UserRepository>;
  let userPreferenceRepositoryMock: sinon.SinonStubbedInstance<UserPreferenceRepository>;
  let postRepositoryMock: sinon.SinonStubbedInstance<PostRepository>;

  beforeEach(() => {
    // Create stubs for all dependencies
    feedServiceMock = sinon.createStubInstance(FeedService);
    redisServiceMock = sinon.createStubInstance(RedisService);
    userRepositoryMock = sinon.createStubInstance(UserRepository);
    userPreferenceRepositoryMock = sinon.createStubInstance(UserPreferenceRepository);
    postRepositoryMock = sinon.createStubInstance(PostRepository);

    // Register mocks in the DI container
    container.register("FeedService", { useValue: feedServiceMock });
    container.register("RedisService", { useValue: redisServiceMock });
    container.register("UserReadRepository", { useValue: userRepositoryMock });
    container.register("UserPreferenceRepository", { useValue: userPreferenceRepositoryMock });
    container.register("PostReadRepository", { useValue: postRepositoryMock });

    // Resolve the handler with mocked dependencies
    handler = container.resolve(FeedInteractionHandler);
  });

  afterEach(() => {
    sinon.restore();
    container.clearInstances();
  });

  it("should handle a 'like' event by updating meta and invalidating only the actor's feed", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent("user123", "like", "postABC", ["tag1"], "owner456");
    const mockPost = { publicId: "postABC", likesCount: 10 } as IPost;

    postRepositoryMock.findByPublicId.resolves(mockPost);
    feedServiceMock.recordInteraction.resolves();
    feedServiceMock.updatePostLikeMeta.resolves();
    redisServiceMock.invalidateByTags.resolves();
    redisServiceMock.pushToStream.resolves();
    redisServiceMock.publish.resolves();

    // Act
    await handler.handle(event);

    // Assert
    // 1. It should record the base interaction
    expect(feedServiceMock.recordInteraction.calledOnceWith("user123", "like", "postABC", ["tag1"])).to.be.true;

    // 2. It should update the post's like metadata cache
    expect(postRepositoryMock.findByPublicId.calledOnceWith("postABC")).to.be.true;
    expect(feedServiceMock.updatePostLikeMeta.calledOnceWith("postABC", 10)).to.be.true;

    // 3. It should invalidate only the actor's structural feed cache using tags
    expect(redisServiceMock.invalidateByTags.calledOnceWith([`user_feed:user123`, `user_for_you_feed:user123`])).to.be
      .true;

    // 4. It should NOT perform broader invalidation for a simple like
    expect(userRepositoryMock.findUsersFollowing.called).to.be.false;
  });

  it("should handle a 'comment' event by performing broader feed invalidation", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent("user123", "comment", "postABC", ["tag1"], "owner456");

    // Mock affected user lookups
    userRepositoryMock.findUsersFollowing
      .withArgs("owner456")
      .resolves([{ publicId: "follower1" }, { publicId: "follower2" }] as any);
    userPreferenceRepositoryMock.getUsersWithTagPreferences
      .withArgs(["tag1"])
      .resolves([{ publicId: "tagLover1" }] as any);

    feedServiceMock.recordInteraction.resolves();
    redisServiceMock.invalidateByTags.resolves();
    redisServiceMock.pushToStream.resolves();
    redisServiceMock.publish.resolves();

    // Act
    await handler.handle(event);

    // Assert
    // 1. It should record the base interaction
    expect(feedServiceMock.recordInteraction.calledOnceWith("user123", "comment", "postABC", ["tag1"])).to.be.true;

    // 2. It should NOT update like meta for a comment
    expect(feedServiceMock.updatePostLikeMeta.called).to.be.false;

    // 3. It should find all affected users (followers and tag-interested users)
    expect(userRepositoryMock.findUsersFollowing.calledOnce).to.be.true;
    expect(userPreferenceRepositoryMock.getUsersWithTagPreferences.calledOnce).to.be.true;

    // 4. It should invalidate all affected users' feeds using tags
    expect(redisServiceMock.invalidateByTags.calledOnce).to.be.true;
    const tagsArg = redisServiceMock.invalidateByTags.firstCall.args[0];
    // Should include actor's feeds and affected users' feeds
    expect(tagsArg).to.include(`user_feed:user123`);
    expect(tagsArg).to.include(`user_for_you_feed:user123`);
    expect(tagsArg).to.include(`user_feed:follower1`);
    expect(tagsArg).to.include(`user_feed:follower2`);
    expect(tagsArg).to.include(`user_feed:tagLover1`);
  });

  it("should throw an error if recordInteraction fails", async () => {
    // Arrange
    const event = new UserInteractedWithPostEvent("user123", "like", "postABC", [], "owner456");
    const testError = new Error("Database connection lost");
    feedServiceMock.recordInteraction.rejects(testError);

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
});
