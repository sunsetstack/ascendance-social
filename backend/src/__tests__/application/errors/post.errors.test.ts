import { expect } from "chai";
import { mapPostError, PostPersistenceError } from "@/application/errors/post.errors";
import { serializeError } from "@/utils/error-serialization";

describe("mapPostError cause preservation", () => {
  it("preserves the native persistence error as Error.cause", () => {
    const mongoError = Object.assign(new Error("write conflict"), {
      name: "MongoServerError",
      code: 112,
      codeName: "WriteConflict",
      errorLabels: ["TransientTransactionError"],
    });

    const mapped = mapPostError(mongoError, {
      action: "record-post-view",
      postPublicId: "11111111-1111-4111-8111-111111111111",
    });
    const serialized = serializeError(mapped);

    expect(mapped).to.be.instanceOf(PostPersistenceError);
    expect(mapped.cause).to.equal(mongoError);
    expect(serialized.cause?.name).to.equal("MongoServerError");
    expect(serialized.cause?.stack).to.equal(mongoError.stack);
    expect(serialized.cause?.code).to.equal(112);
    expect(serialized.cause?.codeName).to.equal("WriteConflict");
    expect(serialized.cause?.errorLabels).to.deep.equal([
      "TransientTransactionError",
    ]);
  });
});
