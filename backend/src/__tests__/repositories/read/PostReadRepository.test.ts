import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon, { SinonStub } from "sinon";
import { Model, Types } from "mongoose";
import { PostReadRepository } from "@/repositories/read/PostReadRepository";
import { asMongoId } from "@/types/branded";

interface MockPostModel {
  aggregate: SinonStub;
}

describe("PostReadRepository", () => {
  let repository: PostReadRepository;
  let mockModel: MockPostModel;

  beforeEach(() => {
    mockModel = {
      aggregate: sinon.stub(),
    };

    repository = new PostReadRepository(mockModel as unknown as Model<any>);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("preserves caller order when fetching posts by ids", async () => {
    const firstId = new Types.ObjectId();
    const secondId = new Types.ObjectId();
    mockModel.aggregate.returns({
      exec: sinon.stub().resolves([]),
    });

    await repository.findPostsByIds([
      asMongoId(firstId.toString()),
      asMongoId(secondId.toString()),
    ]);

    const pipeline = mockModel.aggregate.firstCall.args[0] as any[];
    const addFieldsIndex = pipeline.findIndex((stage) => "$addFields" in stage);
    const sortIndex = pipeline.findIndex(
      (stage) => stage.$sort?.inputOrder === 1,
    );
    const lookupIndex = pipeline.findIndex((stage) => "$lookup" in stage);

    expect(addFieldsIndex).to.be.greaterThan(-1);
    expect(sortIndex).to.be.greaterThan(addFieldsIndex);
    expect(lookupIndex).to.be.greaterThan(sortIndex);

    const orderExpression =
      pipeline[addFieldsIndex].$addFields.inputOrder.$indexOfArray;
    expect(orderExpression[1]).to.equal("$_id");
    expect(orderExpression[0].map(String)).to.deep.equal([
      firstId.toString(),
      secondId.toString(),
    ]);
  });
});
