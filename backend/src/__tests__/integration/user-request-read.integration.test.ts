import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import User from "@/models/user.model";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { UnitOfWork, requireTransactionSession } from "@/database/UnitOfWork";
import { runWithRequestContext } from "@/runtime/request-context";
import { AuthSessionService } from "@/services/auth-session.service";
import { asUserPublicId, asSessionId, asRefreshTokenHash } from "@/types/branded";
import type { AuthSessionRecord } from "@/types";

const uri = process.env.INTEGRATION_MONGODB_URI;
const databaseName = `ascendance_request_reads_${randomUUID().replaceAll("-", "")}`;
(uri ? describe : describe.skip)("Request user reads against MongoDB", function () {
  this.timeout(30_000);
  const publicId = asUserPublicId(randomUUID());
  const id = new Types.ObjectId();
  let repository: UserReadRepository;
  let finds = 0;
  before(async () => {
    if (!uri!.startsWith("mongodb://127.0.0.1:")) throw new Error("Requires isolated local MongoDB");
    await mongoose.connect(uri!, { dbName: databaseName, monitorCommands: true });
    await User.init();
    repository = new UserReadRepository(User, {} as never);
    mongoose.connection.getClient().on("commandStarted", event => {
      if (event.commandName === "find" && event.command.find === "users") finds++;
    });
  });
  beforeEach(async () => {
    await User.deleteMany({});
    await User.collection.insertOne({ _id: id, publicId, username: "Synthetic request user", handle: "request-user",
      email: "request-user@example.invalid", authVersion: 0, isBanned: false, isEmailVerified: true });
    finds = 0;
  });
  after(async () => {
    if (mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("performs one user find per GET while observing changes in the next request", async () => {
    await runWithRequestContext({ correlationId: "one", method: "GET" }, async () => {
      for (let index = 0; index < 3; index++) expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 0 });
    });
    expect(finds).to.equal(1);
    await User.updateOne({ _id: id }, { $inc: { authVersion: 1 }, $set: { isBanned: true } });
    const current = await runWithRequestContext({ correlationId: "two", method: "GET" }, () => repository.findByPublicId(publicId));
    expect(current).to.include({ authVersion: 1, isBanned: true });
    expect(finds).to.equal(2);
  });

  it("keeps session revocation checks fresh across HTTP request contexts", async () => {
    const session: AuthSessionRecord = { sid: asSessionId(randomUUID()), publicId,
      authVersion: 0, isEmailVerified: true, refreshTokenHash: asRefreshTokenHash("synthetic-hash"),
      refreshVersion: 0, createdAt: Date.now(), lastSeenAt: Date.now(), status: "active" };
    const remove = sinon.stub().resolves();
    const auth = new AuthSessionService({ get: async () => session, remove, touch: async () => "updated" } as never, repository);
    await runWithRequestContext({ correlationId: "valid", method: "GET" }, () => auth.assertAccessSession(session.sid, publicId));
    await User.updateOne({ _id: id }, { $inc: { authVersion: 1 } });
    let failure: unknown;
    try {
      await runWithRequestContext({ correlationId: "revoked", method: "GET" }, () => auth.assertAccessSession(session.sid, publicId));
    } catch (error) { failure = error; }
    expect(failure).to.be.instanceOf(Error);
    expect((failure as Error).message).to.equal("Session is invalid or expired");
    expect(remove.calledOnceWithExactly(session.sid, publicId)).to.equal(true);
    expect(finds).to.equal(2);
  });

  it("reads its own transaction writes and refreshes the earlier GET result afterwards", async () => {
    const unit = new UnitOfWork();
    await runWithRequestContext({ correlationId: "transaction", method: "GET" }, async () => {
      expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 0 });
      await unit.executeInTransaction(async () => {
        expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 0 });
        await User.updateOne({ _id: id }, { $inc: { authVersion: 1 } }, { session: requireTransactionSession() });
        expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 1 });
      });
      expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 1 });
    });
    expect(finds).to.equal(4);
  });
});
