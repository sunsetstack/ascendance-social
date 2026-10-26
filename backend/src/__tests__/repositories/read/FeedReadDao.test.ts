import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon, { SinonStub } from "sinon";
import { Model, Types } from "mongoose";
import { FeedReadDao } from "@/repositories/read/FeedReadDao";
import { TagRepository } from "@/repositories/tag.repository";
import {
  decodeFeedCursor,
  FEED_CURSOR_ORDER,
  hashFeedCursorScope,
} from "@/utils/feedCursor";

interface MockPostModel {
  aggregate: SinonStub;
  countDocuments: SinonStub;
  findOne: SinonStub;
}

describe("FeedReadDao", () => {
  let dao: FeedReadDao;
  let mockModel: MockPostModel;
  let mockTagRepository: { findByTags: SinonStub };
  let mockRedisService: {
    getOrCreateFeedCursorSnapshot: SinonStub;
    requireFeedCursorSnapshot: SinonStub;
  };

  beforeEach(() => {
    mockModel = {
      aggregate: sinon.stub(),
      countDocuments: sinon.stub(),
      findOne: sinon.stub(),
    };

    mockTagRepository = {
      findByTags: sinon.stub().resolves([]),
    };
    mockRedisService = {
      getOrCreateFeedCursorSnapshot: sinon
        .stub()
        .callsFake(async (_context: string, build: () => Promise<unknown>) => ({
          id: `${hashFeedCursorScope(["unit-snapshot"])}.1`,
          snapshot: await build(),
        })),
      requireFeedCursorSnapshot: sinon.stub(),
    };

    dao = new FeedReadDao(
      mockModel as unknown as Model<any>,
      mockTagRepository as unknown as TagRepository,
      mockRedisService as any,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("keeps identities and snapshot progress in Following feed projections", async () => {
    const firstId = new Types.ObjectId();
    const secondId = new Types.ObjectId();
    const firstDate = new Date("2024-01-02T00:00:00.000Z");
    const secondDate = new Date("2024-01-01T00:00:00.000Z");

    mockModel.aggregate.returns({
      exec: sinon.stub().resolves([
        {
          _id: firstId,
          publicId: "post-1",
          createdAt: firstDate,
          rankScore: firstDate.getTime(),
        },
        {
          _id: secondId,
          publicId: "post-2",
          createdAt: secondDate,
          rankScore: secondDate.getTime(),
        },
      ]),
    });

    const result = await dao.getFollowingFeedWithCursor("000000000000000000000002", ["000000000000000000000001"], { limit: 1 });

    const pipeline = mockModel.aggregate.firstCall.args[0] as Array<Record<string, unknown>>;
    const projection = pipeline.find((stage) => "$project" in stage)?.$project as Record<
      string,
      unknown
    >;
    const decodedCursor = decodeFeedCursor(result.nextCursor!, {
      feed: "preview",
      orders: [FEED_CURSOR_ORDER.PREVIEW_LATEST],
      source: "mongo",
    });

    expect(projection._id).to.equal(1);
    expect(projection.visibleIdentityId).to.equal(1);
    expect(mockModel.aggregate.calledTwice).to.equal(true);
    expect(result.data).to.have.length(1);
    expect(result.data[0].publicId).to.equal("post-1");
    expect(decodedCursor?.snapshotId).to.equal(`${hashFeedCursorScope(["unit-snapshot"])}.1`);
    expect(decodedCursor?.offset).to.equal(1);
  });

  it("computes ranking score in the active Preview feed pipeline", async () => {
    mockModel.aggregate.returns({
      exec: sinon.stub().resolves([]),
    });

    await dao.getPreviewFeedWithCursor({ topics: ["nature"], sort: "relevant", includeReposts: true }, { limit: 10 });

    const pipeline = mockModel.aggregate.firstCall.args[0] as Array<Record<string, unknown>>;

    const addFieldsStage = pipeline.find((stage) => {
      if (!("$addFields" in stage)) return false;
      const fields = stage.$addFields as any;
      return !!fields.rankScore;
    });

    expect(addFieldsStage).to.exist;
    const fields = (addFieldsStage?.$addFields as any);
    expect(fields.rankScore).to.have.property("$add");
  });

  it("applies limit correctly in new feed cursor pipeline", async () => {
    mockModel.aggregate.returns({
      exec: sinon.stub().resolves([]),
    });

    await dao.getNewFeedWithCursor({ limit: 15 });

    const pipeline = mockModel.aggregate.firstCall.args[0] as Array<Record<string, unknown>>;

    const limitStage = pipeline.find((stage) => "$limit" in stage)?.$limit;

    // the DAO adds +1 to limit to check if 'hasMore' is true
    expect(limitStage).to.equal(16);
  });
});
