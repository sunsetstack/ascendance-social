import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisFeedModule } from "@/services/redis/redis-feed.module";
import { encodeCursor } from "@/utils/cursorCodec";

describe("RedisFeedModule", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("continues scanning additional score batches when the first batch is fully filtered out by the cursor", async () => {
    const buildBatch = (start: number, end: number) =>
      Array.from({ length: start - end + 1 }, (_, index) => ({
        score: 10,
        value: `post-${String(start - index).padStart(3, "0")}`,
      }));

    const zRangeWithScores = sinon.stub();
    zRangeWithScores.onFirstCall().resolves(buildBatch(60, 21));
    zRangeWithScores.onSecondCall().resolves(buildBatch(20, 1));

    const module = new RedisFeedModule({
      zRangeWithScores,
    } as any);

    const result = await module.getTrendingFeedWithCursor(
      20,
      encodeCursor({ trendScore: 10, _id: "post-021" }),
    );

    expect(result.ids).to.deep.equal(buildBatch(20, 1).map((item) => item.value));
    expect(result.hasMore).to.equal(false);
    expect(zRangeWithScores.calledTwice).to.equal(true);
    expect(zRangeWithScores.secondCall.args[3]).to.deep.equal({
      BY: "SCORE",
      REV: true,
      LIMIT: { offset: 40, count: 40 },
    });
  });
});
