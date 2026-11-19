import { expect } from "chai";
import sinon from "sinon";
import { EventRegistry } from "@/application/common/events/event-registry";
import { PostLikeCountReconciledHandler } from "@/application/events/post/post-like-count-reconciled.handler";
import { PostLikeCountReconciledEvent } from "@/application/events/post/post.event";
import { FeedMetaService } from "@/services/feed/feed-meta.service";

describe("PostLikeCountReconciledHandler", () => {
  it("uses the persisted revision as the fallback publication identity for legacy events", async () => {
    const updatePostLikeMeta = sinon.stub().resolves();
    const handler = new PostLikeCountReconciledHandler({ updatePostLikeMeta } as unknown as FeedMetaService,
      { findOneByPublicId: sinon.stub().resolves({ likesCount: 4, likesRevision: 8 }) } as never);
    for (const likesCount of [3, 0]) await handler.handle({ type: EventRegistry.domain.PostLikeCountReconciled,
      postId: "surviving-post", likesCount, timestamp: new Date() } as unknown as PostLikeCountReconciledEvent);
    expect(updatePostLikeMeta.getCalls().map((call) => call.args)).to.deep.equal([
      ["surviving-post", 4, `${EventRegistry.domain.PostLikeCountReconciled}:surviving-post:8`, 8],
      ["surviving-post", 4, `${EventRegistry.domain.PostLikeCountReconciled}:surviving-post:8`, 8],
    ]);
  });

  it("publishes the current count and revision when an older reconciliation event arrives", async () => {
    const updatePostLikeMeta = sinon.stub().resolves();
    const handler = new PostLikeCountReconciledHandler({
      updatePostLikeMeta,
    } as unknown as FeedMetaService, { findOneByPublicId: sinon.stub().resolves({ likesCount: 4, likesRevision: 8 }) } as never);

    await handler.handle({
      type: EventRegistry.domain.PostLikeCountReconciled,
      timestamp: new Date(),
      postId: "surviving-post",
      likesCount: 3,
      eventId: "reconciliation-id",
    } as unknown as PostLikeCountReconciledEvent);

    expect(
      updatePostLikeMeta.calledOnceWithExactly("surviving-post", 4, "reconciliation-id", 8),
    ).to.equal(true);
  });
});
