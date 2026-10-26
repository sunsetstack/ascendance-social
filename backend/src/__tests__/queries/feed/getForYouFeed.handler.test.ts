import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { Errors } from "@/utils/errors";

describe("GetForYouFeedQueryHandler", () => {
  const viewer = "169a5f61-f74c-4800-9659-3d2cd27f2423";
  const internalId = "507f1f77bcf86cd799439011";
  const profile = { selected: ["finance"], topics: { crypto: 2 }, formats: { image: 3 }, revision: 7 };

  function fixture() {
    const feeds = { getInterestFeedWithCursor: sinon.stub().resolves({ data: [], hasMore: false }) };
    const users = { findByPublicId: sinon.stub().resolves({ _id: internalId }) };
    const preferences = { read: sinon.stub().resolves(profile) };
    const enrichment = { enrichFeedWithCurrentData: sinon.stub().callsFake(async (posts: unknown[]) => posts) };
    return { feeds, users, preferences, enrichment,
      handler: new GetForYouFeedQueryHandler(feeds as never, users as never, preferences as never, enrichment as never) };
  }

  it("passes chosen, learned, and format preferences together with the authenticated viewer", async () => {
    const f = fixture();
    const result = await f.handler.execute(new GetForYouFeedQuery(viewer, 1, 10));
    expect(f.preferences.read.calledOnceWithExactly(internalId)).to.equal(true);
    expect(f.feeds.getInterestFeedWithCursor.firstCall.args).to.deep.equal([
      { topics: [], sort: "personalized", viewer, viewerMongoId: internalId, profile, destination: "for-you" },
      { limit: 10, cursor: undefined },
    ]);
    expect(result).to.deep.equal({ data: [], hasMore: false, nextCursor: undefined, page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it("preserves pinned traversal and hydrates identity after ranking", async () => {
    const f = fixture();
    f.feeds.getInterestFeedWithCursor.resolves({ data: [{ publicId: "post", author: { publicId: "author", handle: "old", username: "Old" }, tags: [] }], hasMore: true, nextCursor: "next" });
    f.enrichment.enrichFeedWithCurrentData.resolves([{ publicId: "post", user: { handle: "current" } }]);
    const result = await f.handler.execute(new GetForYouFeedQuery(viewer, 2, 10, "pinned"));
    expect(f.preferences.read.called).to.equal(false);
    expect(f.feeds.getInterestFeedWithCursor.firstCall.args).to.deep.equal([
      { topics: [], sort: "personalized", viewer, viewerMongoId: internalId, profile: undefined, destination: "for-you" },
      { limit: 10, cursor: "pinned" },
    ]);
    expect(f.enrichment.enrichFeedWithCurrentData.firstCall.args[0][0].user.handle).to.equal("old");
    expect(result.data[0].user.handle).to.equal("current");
    expect(result.nextCursor).to.equal("next");
  });

  it("does not rank or read another profile when the authenticated account is missing", async () => {
    const f = fixture(); f.users.findByPublicId.resolves(null);
    const error = await f.handler.execute(new GetForYouFeedQuery(viewer, 1, 10)).catch((reason: unknown) => reason);
    expect(error).to.include({ statusCode: 404, message: "User not found" });
    expect(f.preferences.read.called).to.equal(false); expect(f.feeds.getInterestFeedWithCursor.called).to.equal(false);
  });

  it("propagates storage and cursor failures without substituting another feed", async () => {
    for (const boundary of ["preferences", "feeds"] as const) {
      const f = fixture();
      const failure = boundary === "feeds" ? Errors.validation("Cursor belongs to another viewer") : Errors.database("Preference store unavailable");
      if (boundary === "feeds") f.feeds.getInterestFeedWithCursor.rejects(failure);
      else f.preferences.read.rejects(failure);
      const error = await f.handler.execute(new GetForYouFeedQuery(viewer, 1, 10)).catch((reason: unknown) => reason);
      expect(error).to.equal(failure); expect(f.enrichment.enrichFeedWithCurrentData.called).to.equal(false);
    }
  });
});
