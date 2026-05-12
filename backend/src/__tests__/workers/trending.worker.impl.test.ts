import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { TrendingWorker } from "@/workers/_impl/trending.worker.impl";

describe("TrendingWorker", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("defers ACKs until a flush successfully updates Redis", async () => {
    const worker = new TrendingWorker({} as any);
    const ackStreamMessages = sinon.stub().resolves(1);
    const updateTrendingScore = sinon.stub().resolves();
    const setWithTags = sinon.stub().resolves();

    (worker as any).redisService = {
      ackStreamMessages,
      updateTrendingScore,
      setWithTags,
    };
    (worker as any).postRepo = {
      findPostsByPublicIds: sinon.stub().resolves([
        {
          publicId: "post-1",
          likes: 3,
          commentsCount: 1,
          viewsCount: 0,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ]),
    };

    await (worker as any).handleStreamMessage("1-0", { postId: "post-1" });

    expect(ackStreamMessages.called).to.be.false;
    expect((worker as any).pending.get("post-1").messageIds).to.deep.equal(["1-0"]);

    await (worker as any).flushPending();

    expect(updateTrendingScore.calledOnce).to.be.true;
    expect(updateTrendingScore.firstCall.args[0]).to.equal("post-1");
    expect(updateTrendingScore.firstCall.args[2]).to.equal("trending:posts");
    expect(setWithTags.calledOnce).to.be.true;
    expect(ackStreamMessages.calledOnceWith("stream:interactions", "trendingGroup", "1-0")).to.be.true;
    expect((worker as any).pending.size).to.equal(0);
  });

  it("requeues staged messages when flush fails before ACKing", async () => {
    const worker = new TrendingWorker({} as any);
    const ackStreamMessages = sinon.stub().resolves(1);
    const updateTrendingScore = sinon.stub().rejects(new Error("Redis write failed"));
    const setWithTags = sinon.stub().resolves();

    (worker as any).redisService = {
      ackStreamMessages,
      updateTrendingScore,
      setWithTags,
    };
    (worker as any).postRepo = {
      findPostsByPublicIds: sinon.stub().resolves([
        {
          publicId: "post-1",
          likes: 3,
          commentsCount: 1,
          viewsCount: 0,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ]),
    };

    await (worker as any).handleStreamMessage("1-0", { postId: "post-1" });
    await (worker as any).flushPending();

    expect(ackStreamMessages.called).to.be.false;
    expect((worker as any).pending.get("post-1").messageIds).to.deep.equal(["1-0"]);
  });
});
