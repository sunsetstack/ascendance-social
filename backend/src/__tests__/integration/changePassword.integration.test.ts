/**
 * ChangePassword command integration tests.
 *
 * Wires the real ChangePasswordCommandHandler through a real CommandBus with
 * sinon-stubbed I/O dependencies.
 *
 * The handler uses `userModel.findOne(...).select('+password').session(null).exec()`
 * inside the UnitOfWork transaction. We simulate this with a stub chain and a
 * stored password hash.
 *
 * Proves:
 *   - Short new password (< 3 chars): ValidationError (400) — no I/O at all
 *   - New password same as current: ValidationError (400) — no I/O at all
 *   - User not found (model returns null): NotFoundError (404)
 *   - Wrong current password: AuthenticationError (401)
 *   - Happy path: update called with new password, action logged
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { CommandBus } from "@/application/common/buses/command.bus";
import { ChangePasswordCommand } from "@/application/commands/users/changePassword/changePassword.command";
import { ChangePasswordCommandHandler } from "@/application/commands/users/changePassword/changePassword.handler";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asMongoId } from "@/types/branded";
import { hashPassword } from "@/application/common/policies/password.policy";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_PID = asUserPublicId("user-pub-01");
const USER_MID = "aaaaaaaaaaaaaaaaaaaaaaaa";

const CURRENT_PASSWORD = "current_pass";
const NEW_PASSWORD = "new_pass_xyz";

// ---------------------------------------------------------------------------
// Fake document factories
// ---------------------------------------------------------------------------

const makeUserDoc = async (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => USER_MID },
  publicId: USER_PID,
  password: await hashPassword(CURRENT_PASSWORD),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Builds the mongoose Model stub chain:
 *   userModel.findOne(...)
 *     .select('+password')
 *     .session(null)
 *     .exec()  → resolves(userDoc | null)
 */
const makeModelStub = (resolvedDoc: unknown) => {
  const execStub = sinon.stub().resolves(resolvedDoc);
  const sessionStub = sinon.stub().returns({ exec: execStub });
  const selectStub = sinon.stub().returns({ session: sessionStub });
  const findOneStub = sinon.stub().returns({ select: selectStub });
  return { findOne: findOneStub, _exec: execStub };
};

const makeStubs = (resolvedDoc: unknown) => ({
  userWriteRepo: {
    update: sinon.stub().resolves(),
  },
  unitOfWork: {
    executeInTransaction: sinon.stub().callsFake(async (fn: () => Promise<void>) => fn()),
  },
  userActionRepo: {
    logAction: sinon.stub().resolves(),
  },
  userModel: makeModelStub(resolvedDoc),
});

const buildHandler = (stubs: ReturnType<typeof makeStubs>) =>
  new ChangePasswordCommandHandler(
    stubs.userWriteRepo as any,
    stubs.unitOfWork as any,
    stubs.userActionRepo as any,
    stubs.userModel as any,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChangePasswordCommandHandler integration (via CommandBus)", () => {
  let bus: CommandBus;
  let stubs: ReturnType<typeof makeStubs>;

  beforeEach(async () => {
    stubs = makeStubs(await makeUserDoc());
    bus = new CommandBus();
    bus.register(ChangePasswordCommand, buildHandler(stubs));
  });

  afterEach(() => sinon.restore());

  // -------------------------------------------------------------------------
  // Pre-I/O validation
  // -------------------------------------------------------------------------

  it("throws ValidationError (400) when new password is shorter than 3 characters", async () => {
    const err = await bus
      .dispatch(new ChangePasswordCommand(USER_PID, CURRENT_PASSWORD, "ab"))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  it("throws ValidationError (400) when new password equals current password", async () => {
    const err = await bus
      .dispatch(
        new ChangePasswordCommand(USER_PID, CURRENT_PASSWORD, CURRENT_PASSWORD),
      )
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Inside-transaction failures
  // -------------------------------------------------------------------------

  it("throws NotFoundError (404) when user is not found in the database", async () => {
    stubs = makeStubs(null); // userModel returns null
    bus = new CommandBus();
    bus.register(ChangePasswordCommand, buildHandler(stubs));

    const err = await bus
      .dispatch(new ChangePasswordCommand(USER_PID, CURRENT_PASSWORD, NEW_PASSWORD))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.userWriteRepo.update.called).to.be.false;
  });

  it("throws AuthenticationError (401) when the current password is wrong", async () => {
    const doc = await makeUserDoc();
    stubs = makeStubs(doc);
    bus = new CommandBus();
    bus.register(ChangePasswordCommand, buildHandler(stubs));

    const err = await bus
      .dispatch(new ChangePasswordCommand(USER_PID, "wrong_password", NEW_PASSWORD))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(401);
    expect(stubs.userWriteRepo.update.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("updates the user password and logs the action when credentials are correct", async () => {
    await bus.dispatch(
      new ChangePasswordCommand(USER_PID, CURRENT_PASSWORD, NEW_PASSWORD),
    );

    expect(stubs.userWriteRepo.update.calledOnce).to.be.true;
    const [id, patch] = stubs.userWriteRepo.update.getCall(0).args;
    expect(id).to.equal(asMongoId(USER_MID));
    expect((patch as any).$set.password).to.equal(NEW_PASSWORD);

    expect(stubs.userActionRepo.logAction.calledOnce).to.be.true;
    const [actionId, action] = stubs.userActionRepo.logAction.getCall(0).args;
    expect(actionId).to.equal(asMongoId(USER_MID));
    expect(action).to.equal("password_change");
  });

  it("performs all I/O inside the UnitOfWork transaction", async () => {
    await bus.dispatch(
      new ChangePasswordCommand(USER_PID, CURRENT_PASSWORD, NEW_PASSWORD),
    );

    expect(stubs.unitOfWork.executeInTransaction.calledOnce).to.be.true;
    // Both DB writes happen inside the transaction callback
    expect(stubs.userWriteRepo.update.calledOnce).to.be.true;
    expect(stubs.userActionRepo.logAction.calledOnce).to.be.true;
  });
});
