import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { PostDeleteHandler } from "@/application/events/post/post-deleted.handler";
import { PostUploadHandler } from "@/application/events/post/post-uploaded.handler";
import { PostDeletedEvent, PostUploadedEvent } from "@/application/events/post/post.event";
import type { PostPublicId, UserPublicId } from "@/types/branded";

describe("post feed materialization handlers", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("materializes uploaded posts into author, follower, and tag-interest feeds", async () => {
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

    expect(redis.addToFeedsBatch.calledOnce).to.equal(true);
    expect(redis.addToFeedsBatch.firstCall.args).to.deep.equal([
      ["author-1", "follower-1", "shared-user", "tag-user-1"],
      "post-1",
      event.timestamp.getTime(),
      "for_you",
    ]);
  });

  it("removes deleted posts from author and follower feeds", async () => {
    const redis = buildRedisStub();
    const userRepository = {
      findUsersFollowing: sinon.stub().resolves([
        { publicId: "follower-1" },
        { publicId: "follower-2" },
      ]),
    };
    const handler = new PostDeleteHandler(redis as any, userRepository as any);
    const event = new PostDeletedEvent(
      "post-1" as PostPublicId,
      "author-1" as UserPublicId,
    );

    await handler.handle(event);

    expect(redis.removeFromFeedsBatch.calledOnce).to.equal(true);
    expect(redis.removeFromFeedsBatch.firstCall.args).to.deep.equal([
      ["author-1", "follower-1", "follower-2"],
      "post-1",
      "for_you",
    ]);
  });

  it("does not rematerialize a post after its account cleanup removed it", async () => {
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

    expect(redis.addToFeedsBatch.called).to.equal(false);
    expect(userActivityService.trackPostCreated.called).to.equal(false);
  });
});

const buildRedisStub = () => ({
  addToFeedsBatch: sinon.stub().resolves(undefined),
  removeFromFeedsBatch: sinon.stub().resolves(undefined),
  invalidateByTags: sinon.stub().resolves(undefined),
  deletePatterns: sinon.stub().resolves(undefined),
  publish: sinon.stub().resolves(undefined),
  zrem: sinon.stub().resolves(1),
});
