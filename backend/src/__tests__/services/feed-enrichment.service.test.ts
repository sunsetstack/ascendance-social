import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { PostCountersRepository } from "@/repositories/read/PostCountersRepository";
import type { FeedPost } from "@/types";
import { asUserPublicId } from "@/types/branded";

describe("Feed enrichment counter ordering", () => {
  const author = { publicId: "author", handle: "author", username: "Author", avatar: "" };
  function page(revision: number, likes: number): FeedPost[] {
    return [{ publicId: "wrapper", body: "", slug: "wrapper", createdAt: new Date(0),
      likes, likesRevision: revision, commentsCount: 0, viewsCount: 0,
      userPublicId: asUserPublicId(author.publicId), user: author, tags: [],
      repostOf: { publicId: "original", user: author, likes, likesRevision: revision, commentsCount: 0 } }];
  }

  it("keeps newer loaded counts when two requests share an older pending read", async () => {
    let finish!: (rows: unknown[]) => void;
    const exec = sinon.stub().returns(new Promise((resolve) => { finish = resolve; }));
    const find = sinon.stub().returns({ select: () => ({ lean: () => ({ exec }) }) });
    const enrichment = new FeedEnrichmentService({ findMany: async () => [] }, new PostCountersRepository({ find } as never));
    const olderRequest = enrichment.enrichFeedWithCurrentData(page(5, 2), { refreshCounters: true });
    const newerRequest = enrichment.enrichFeedWithCurrentData(page(6, 3), { refreshCounters: true });
    finish(["wrapper", "original"].map((publicId) => ({ publicId, likesCount: 2, likesRevision: 5 })));
    const [older, newer] = await Promise.all([olderRequest, newerRequest]);
    expect(find.callCount).to.equal(1);
    expect(older[0]).to.include({ likes: 2, likesRevision: 5 });
    expect(newer[0]).to.include({ likes: 3, likesRevision: 6 });
    expect(newer[0].repostOf).to.include({ likes: 3, likesRevision: 6 });
  });

  it("accepts a decreasing count when its revision is newer", async () => {
    const enrichment = new FeedEnrichmentService({ findMany: async () => [] }, {
      getPostMetadata: async (ids) => ids.map(() => ({ likes: 0, likesRevision: 7, commentsCount: 0, viewsCount: 0 })),
    });
    const [result] = await enrichment.enrichFeedWithCurrentData(page(6, 3), { refreshCounters: true });
    expect(result).to.include({ likes: 0, likesRevision: 7 });
    expect(result.repostOf).to.include({ likes: 0, likesRevision: 7 });
  });

  it("keeps freshly loaded pages free of additional counter reads", async () => {
    const getPostMetadata = sinon.stub().rejects(new Error("Unexpected counter read"));
    const enrichment = new FeedEnrichmentService({ findMany: async () => [] }, { getPostMetadata });
    const loaded = page(6, 3);
    expect(await enrichment.enrichFeedWithCurrentData(loaded)).to.deep.equal(loaded);
    expect(getPostMetadata.called).to.equal(false);
  });
});
