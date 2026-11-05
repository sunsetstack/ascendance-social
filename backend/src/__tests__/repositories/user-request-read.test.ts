import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { runWithRequestContext } from "@/runtime/request-context";
import { asUserPublicId } from "@/types/branded";
import { sessionALS } from "@/database/UnitOfWork";
import type { ClientSession } from "mongoose";

describe("User reads within one HTTP GET", () => {
  function fixture() {
    let authVersion = 0;
    const exec = sinon.stub().callsFake(async () => ({ authVersion, isBanned: authVersion > 0 }));
    const session = sinon.stub().returnsThis();
    const findOne = sinon.stub().returns({ exec, session });
    return { repository: new UserReadRepository({ findOne } as never, {} as never), exec, findOne, session,
      changeUser: () => { authVersion++; } };
  }
  const publicId = asUserPublicId("viewer");

  it("shares sequential and concurrent lookups only inside the same GET", async () => {
    const { repository, findOne } = fixture();
    await runWithRequestContext({ correlationId: "one", method: "GET" }, async () => {
      await repository.findByPublicId(publicId);
      await Promise.all([repository.findByPublicId(publicId), repository.findByPublicId(publicId)]);
    });
    expect(findOne.callCount).to.equal(1);
    await runWithRequestContext({ correlationId: "two", method: "GET" }, () => repository.findByPublicId(publicId));
    expect(findOne.callCount).to.equal(2);
  });

  it("observes auth-version and ban changes on the next GET", async () => {
    const { repository, changeUser } = fixture();
    const before = await runWithRequestContext({ correlationId: "one", method: "GET" }, () => repository.findByPublicId(publicId));
    changeUser();
    const after = await runWithRequestContext({ correlationId: "two", method: "GET" }, () => repository.findByPublicId(publicId));
    expect(before).to.include({ authVersion: 0, isBanned: false });
    expect(after).to.include({ authVersion: 1, isBanned: true });
  });

  it("rereads after writes and outside HTTP GET contexts", async () => {
    for (const method of ["POST", "PATCH", "DELETE", undefined]) {
      const { repository, findOne, changeUser } = fixture();
      await runWithRequestContext({ correlationId: "mutation", method }, async () => {
        await repository.findByPublicId(publicId); changeUser();
        expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 1 });
      });
      expect(findOne.callCount).to.equal(2);
    }
    const { repository, findOne } = fixture();
    await repository.findByPublicId(publicId); await repository.findByPublicId(publicId);
    expect(findOne.callCount).to.equal(2);
  });

  it("does not mix users or retain failed lookups", async () => {
    const { repository, exec, findOne } = fixture();
    const failure = new Error("query interrupted");
    exec.onFirstCall().rejects(failure);
    await runWithRequestContext({ correlationId: "failure", method: "GET" }, async () => {
      let observed;
      try { await repository.findByPublicId(publicId); } catch (error) { observed = error; }
      expect(observed).to.equal(failure);
      await repository.findByPublicId(publicId);
      await repository.findByPublicId(asUserPublicId("another"));
    });
    expect(findOne.callCount).to.equal(3);
  });

  it("bypasses request reuse inside transactions and discards the earlier GET read", async () => {
    const { repository, changeUser, findOne, session } = fixture();
    const activeSession = { inTransaction: () => true } as ClientSession;
    await runWithRequestContext({ correlationId: "transaction", method: "GET" }, async () => {
      await repository.findByPublicId(publicId);
      await sessionALS.run(activeSession, async () => {
        await repository.findByPublicId(publicId); changeUser();
        expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 1 });
      });
      expect(await repository.findByPublicId(publicId)).to.include({ authVersion: 1 });
    });
    expect(findOne.callCount).to.equal(4);
    expect(session.callCount).to.equal(2);
    expect(session.alwaysCalledWithExactly(activeSession)).to.equal(true);
  });
});
