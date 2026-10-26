import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { PostDeleteHandler } from "@/application/events/post/post-deleted.handler";
import { PostUploadHandler } from "@/application/events/post/post-uploaded.handler";
import { PostDeletedEvent, PostUploadedEvent } from "@/application/events/post/post.event";
import { EventRegistry } from "@/application/common/events/event-registry";
import type { PostPublicId, UserPublicId } from "@/types/branded";

describe("post feed update handlers", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("notifies distinct followers and tag-interested users about uploaded posts", async () => {
    const redis = buildRedisStub();
    const userRepository = {
      findByPublicId: sinon.stub().resolves({ isBanned: false }),
      findUsersFollowing: sinon.stub().resolves([
        { publicId: "follower-1" },
        { publicId: "shared-user" },
      ]),
    };
    const userPreferenceRepository = {
      getUsersWithTagPreferences: sinon.stub().resolves([
        { publicId: "tag-user-1" },
        { publicId: "shared-user" },
      ]),
    };
    const userActivityService = {
      trackPostCreated: sinon.stub().resolves(undefined),
    };
    const postRepository = {
      findByPublicId: sinon.stub().resolves({ publicId: "post-1" }),
    };
    const handler = new PostUploadHandler(
      redis as any,
      userRepository as any,
      postRepository as any,
      userPreferenceRepository as any,
      userActivityService as any,
    );
    const event = new PostUploadedEvent(
      "post-1" as PostPublicId,
      "author-1" as UserPublicId,
      ["typescript"],
    );

    await handler.handle(event);

    expect(redis.publish.calledOnce).to.equal(true);
    expect(redis.publish.firstCall.args[0]).to.equal(
      EventRegistry.redisChannels.feedUpdates,
    );
    const payload = JSON.parse(redis.publish.firstCall.args[1]);
    expect(payload).to.include({
      type: EventRegistry.realtimeMessageTypes.newPost,
      authorId: "author-1",
      postId: "post-1",
      timestamp: event.timestamp.toISOString(),
    });
    expect(payload.tags).to.deep.equal(["typescript"]);
    expect(payload.affectedUsers).to.deep.equal([
      "follower-1", "shared-user", "tag-user-1",
    ]);
    expect(userActivityService.trackPostCreated.calledOnceWithExactly("author-1"))
      .to.equal(true);
  });

  it("removes deleted posts from Trending and publishes the deletion", async () => {
    const redis = buildRedisStub();
    const handler = new PostDeleteHandler(redis as any);
    const event = new PostDeletedEvent(
      "post-1" as PostPublicId,
      "author-1" as UserPublicId,
    );

    await handler.handle(event);

    expect(redis.zrem.calledOnceWithExactly("trending:posts", "post-1"))
      .to.equal(true);
    expect(redis.publish.calledOnce).to.equal(true);
    expect(redis.publish.firstCall.args[0]).to.equal(
      EventRegistry.redisChannels.feedUpdates,
    );
    expect(JSON.parse(redis.publish.firstCall.args[1])).to.include({
      type: EventRegistry.realtimeMessageTypes.postDeleted,
      postId: "post-1",
      authorId: "author-1",
      timestamp: event.timestamp.toISOString(),
    });
  });

  it("ignores a post upload after account cleanup removed the post", async () => {
    const redis = buildRedisStub();
    const userRepository = {
      findByPublicId: sinon.stub().resolves({ isBanned: false }),
      findUsersFollowing: sinon.stub(),
    };
    const postRepository = { findByPublicId: sinon.stub().resolves(null) };
    const userPreferenceRepository = {
      getUsersWithTagPreferences: sinon.stub(),
    };
    const userActivityService = { trackPostCreated: sinon.stub() };
    const handler = new PostUploadHandler(
      redis as any,
      userRepository as any,
      postRepository as any,
      userPreferenceRepository as any,
      userActivityService as any,
    );

    await handler.handle(
      new PostUploadedEvent(
        "removed-post" as PostPublicId,
        "departed-user" as UserPublicId,
        [],
      ),
    );

    expect(redis.publish.called).to.equal(false);
    expect(userActivityService.trackPostCreated.called).to.equal(false);
    expect(userRepository.findUsersFollowing.called).to.equal(false);
    expect(userPreferenceRepository.getUsersWithTagPreferences.called).to.equal(false);
  });
});

const buildRedisStub = () => ({
  invalidateByTags: sinon.stub().resolves(undefined),
  deletePatterns: sinon.stub().resolves(undefined),
  publish: sinon.stub().resolves(undefined),
  zrem: sinon.stub().resolves(1),
});
