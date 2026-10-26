import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { ClientSession, mongo } from "mongoose";
import Post from "@/models/post.model";
import User from "@/models/user.model";
import PostLike from "@/models/postLike.model";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { UserWriteRepository } from "@/repositories/write/UserWriteRepository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { sessionALS } from "@/database/UnitOfWork";
import { isRetryableTransactionBodyError } from "@/database/transaction-retry";
import { serializeError } from "@/utils/error-serialization";
import { MongoId } from "@/types/branded";

describe("Feed mutation database error evidence", () => {
  const id = "507f1f77bcf86cd799439011" as MongoId;
  const session = { inTransaction: () => true } as ClientSession;
  let sandbox: sinon.SinonSandbox;
  let failure: mongo.MongoServerError;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    failure = new mongo.MongoServerError({ message: "write conflict", code: 112, errorLabels: ["TransientTransactionError"] });
  });
  afterEach(() => sandbox.restore());

  function assertRetryEvidence(error: unknown): void {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).cause).to.equal(failure);
    expect(serializeError(error).cause?.stack).to.equal(failure.stack);
    expect(isRetryableTransactionBodyError(error)).to.equal(true);
  }

  for (const method of ["updateLikeCount", "updateCommentCount", "updateRepostCount"] as const) {
    it(`keeps the active session and native retry evidence for ${method}`, async () => {
      const query = method === "updateRepostCount" ? Post.updateOne({}, {}) : Post.findByIdAndUpdate(id, {});
      sandbox.stub(query, "exec").rejects(failure);
      const write = method === "updateRepostCount"
        ? sandbox.stub(Post, "updateOne").returns(query as ReturnType<typeof Post.updateOne>)
        : sandbox.stub(Post, "findByIdAndUpdate").returns(query as ReturnType<typeof Post.findByIdAndUpdate>);
      const repository = new PostWriteRepository(Post);
      const error = await sessionALS.run(session, () => repository[method](id, 1)).catch((error: unknown) => error);
      assertRetryEvidence(error);
      sinon.assert.calledOnce(write);
      const options = method === "updateRepostCount" ? query.getOptions() : write.firstCall.args[2];
      expect(options?.session).to.equal(session);
    });
  }

  it("preserves retry evidence from the user post-count update", async () => {
    const query = User.findOneAndUpdate({}, {});
    sandbox.stub(query, "exec").rejects(failure);
    sandbox.stub(User, "findOneAndUpdate").returns(query);
    const error = await sessionALS.run(session, () => new UserWriteRepository(User).update(id, { $inc: { postCount: 1 } })).catch((error: unknown) => error);
    assertRetryEvidence(error);
    expect(query.getOptions().session).to.equal(session);
  });

  it("preserves retry evidence from the like insert", async () => {
    const create = sandbox.stub(PostLike, "create").rejects(failure);
    const error = await sessionALS.run(session, () => new PostLikeRepository(PostLike).addLike(id, id)).catch((error: unknown) => error);
    assertRetryEvidence(error);
    expect(create.firstCall.args[1]).to.deep.equal({ session });
  });

  it("does not turn an unlabelled database error into a retryable conflict", async () => {
    const query = Post.findByIdAndUpdate(id, {});
    const unlabelled = new Error("connection closed");
    sandbox.stub(query, "exec").rejects(unlabelled);
    sandbox.stub(Post, "findByIdAndUpdate").returns(query);
    const error = await new PostWriteRepository(Post).updateLikeCount(id, 1).catch((error: unknown) => error);
    expect((error as Error).cause).to.equal(unlabelled);
    expect(isRetryableTransactionBodyError(error)).to.equal(false);
  });
});
