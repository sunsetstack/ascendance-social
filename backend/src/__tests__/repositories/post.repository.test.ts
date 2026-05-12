import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon, { SinonStub } from "sinon";
import { Model, Types } from "mongoose";
import { PostRepository } from "@/repositories/post.repository";
import { TagRepository } from "@/repositories/tag.repository";
import { decodeCursor } from "@/utils/cursorCodec";

interface MockPostModel {
  aggregate: SinonStub;
  findOne: SinonStub;
}

describe("PostRepository", () => {
  let repository: PostRepository;
  let mockModel: MockPostModel;
  let mockTagRepository: { findByTags: SinonStub };

  beforeEach(() => {
    mockModel = {
      aggregate: sinon.stub(),
      findOne: sinon.stub(),
    };

    mockTagRepository = {
      findByTags: sinon.stub().resolves([]),
    };

    repository = new PostRepository(
      mockModel as unknown as Model<any>,
      mockTagRepository as unknown as TagRepository,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("sorts text-search results before limiting them", async () => {
    mockModel.aggregate.returns({
      exec: sinon.stub().resolves([]),
    });

    await repository.searchByText(["hello", "world"], 5);

    const pipeline = mockModel.aggregate.firstCall.args[0] as Array<Record<string, unknown>>;
    const stageNames = pipeline.map((stage) => Object.keys(stage)[0]);

    expect(stageNames.indexOf("$sort")).to.be.lessThan(stageNames.indexOf("$limit"));
  });

});
