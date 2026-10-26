import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";

describe("Home preference ranking", () => {
  it("uses the shared preference policy while retaining a separate Home cursor scope", async () => {
    const forYou = { execute: sinon.stub().resolves({ data: [{ publicId: "post" }], hasMore: true, nextCursor: "next" }) };
    const handler = new GetPersonalizedFeedQueryHandler(forYou as never);
    expect(await handler.execute(new GetPersonalizedFeedQuery("viewer", 2, 10, "pinned"))).to.deep.equal({ data: [{ publicId: "post" }], hasMore: true, nextCursor: "next" });
    expect(forYou.execute.calledOnceWithExactly(new GetForYouFeedQuery("viewer", 2, 10, "pinned", "home"))).to.equal(true);
  });

  it("propagates a ranking failure without replacing Home with another feed", async () => {
    const failure = new Error("Ranking unavailable");
    const forYou = { execute: sinon.stub().rejects(failure) };
    const handler = new GetPersonalizedFeedQueryHandler(forYou as never);
    const error = await handler.execute(new GetPersonalizedFeedQuery("viewer", 1, 10)).catch((reason: unknown) => reason);
    expect(error).to.equal(failure); expect(forYou.execute.callCount).to.equal(1);
  });
});
