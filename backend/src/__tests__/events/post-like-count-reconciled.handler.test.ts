import { expect } from "chai";
import sinon from "sinon";
import { EventRegistry } from "@/application/common/events/event-registry";
import { PostLikeCountReconciledHandler } from "@/application/events/post/post-like-count-reconciled.handler";
import { PostLikeCountReconciledEvent } from "@/application/events/post/post.event";
import { FeedMetaService } from "@/services/feed/feed-meta.service";

describe("PostLikeCountReconciledHandler", () => {
  it("refreshes Redis post metadata from a durable reconciliation event", async () => {
    const updatePostLikeMeta = sinon.stub().resolves();
    const handler = new PostLikeCountReconciledHandler({
      updatePostLikeMeta,
    } as unknown as FeedMetaService);

    await handler.handle({
      type: EventRegistry.domain.PostLikeCountReconciled,
      timestamp: new Date(),
      postId: "surviving-post",
      likesCount: 3,
    } as unknown as PostLikeCountReconciledEvent);

    expect(
      updatePostLikeMeta.calledOnceWithExactly("surviving-post", 3),
    ).to.equal(true);
  });
});
