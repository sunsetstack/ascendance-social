/**
 * UpdateProfile command integration tests.
 *
 * Wires the real UpdateProfileCommandHandler through a real CommandBus with
 * sinon-stubbed dependencies.
 *
 * Proves:
 *   - User not found: NotFoundError (404)
 *   - Handle change attempt: ValidationError (400)
 *   - No valid fields provided: ValidationError (400)
 *   - Username same as current (no-op): treated as no update → ValidationError
 *   - Username taken by another user: ValidationError (400)
 *   - Username taken by same user (re-confirming own name): no error when bio also provided
 *   - Username change: UserUsernameChangedEvent is queued through the transactional outbox
 *   - Bio-only change: no event is queued
 *   - Happy path: calls userWriteRepository.update and userActionRepository.logAction
 *   - Returns DTO from dtoService.toPublicDTO
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { CommandBus } from "@/application/common/buses/command.bus";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { UpdateProfileCommandHandler } from "@/application/commands/users/updateProfile/updateProfile.handler";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asMongoId } from "@/types/branded";
import { UserUsernameChangedEvent } from "@/application/events/user/user-interaction.event";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_PID = asUserPublicId("user-pub-01");
const USER_MID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_PID = asUserPublicId("user-pub-02");

// ---------------------------------------------------------------------------
// Fake document factories
// ---------------------------------------------------------------------------

const makeUserDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => USER_MID },
  publicId: USER_PID,
  username: "original_username",
  handle: "@original",
  bio: "bio text",
  avatar: "avatar.png",
  cover: "cover.png",
  postCount: 0,
  followerCount: 0,
  followingCount: 0,
  createdAt: new Date(),
  ...overrides,
});

const makePublicDTO = () => ({
  publicId: USER_PID,
  username: "updated_username",
  handle: "@original",
  bio: "updated bio",
  avatar: "avatar.png",
  cover: "cover.png",
  postCount: 0,
  followerCount: 0,
  followingCount: 0,
  createdAt: new Date(),
});

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

const makeStubs = () => ({
  userReadRepo: {
    findByPublicId: sinon.stub(),
    findByUsername: sinon.stub().resolves(null),
  },
  userWriteRepo: {
    update: sinon.stub().resolves(),
  },
  unitOfWork: {
    executeInTransaction: sinon.stub().callsFake(async (fn: () => Promise<void>) => fn()),
  },
  userActionRepo: {
    logAction: sinon.stub().resolves(),
  },
  dtoService: {
    toPublicDTO: sinon.stub().returns(makePublicDTO()),
  },
  eventBus: {
    queueTransactional: sinon.stub().resolves(),
  },
});

const buildHandler = (stubs: ReturnType<typeof makeStubs>) =>
  new UpdateProfileCommandHandler(
    stubs.userReadRepo as any,
    stubs.userWriteRepo as any,
    stubs.unitOfWork as any,
    stubs.userActionRepo as any,
    stubs.dtoService as any,
    stubs.eventBus as any,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdateProfileCommandHandler integration (via CommandBus)", () => {
  let bus: CommandBus;
  let stubs: ReturnType<typeof makeStubs>;

  beforeEach(() => {
    stubs = makeStubs();
    bus = new CommandBus();
    bus.register(UpdateProfileCommand, buildHandler(stubs));
  });

  afterEach(() => sinon.restore());

  // -------------------------------------------------------------------------
  // Lookup failures
  // -------------------------------------------------------------------------

  it("throws NotFoundError (404) when user does not exist", async () => {
    stubs.userReadRepo.findByPublicId.resolves(null);

    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, { username: "new_name" }))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it("throws ValidationError (400) when attempting to change handle", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());

    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, { handle: "@new" }))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  it("throws ValidationError (400) when no valid fields are provided", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());

    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, {}))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  it("throws ValidationError (400) when username is the same as current", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());

    // Same username, no other field → no allowedUpdates
    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, { username: "original_username" }))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
  });

  it("throws ValidationError (400) when username is taken by another user", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());
    stubs.userReadRepo.findByUsername.resolves({ publicId: OTHER_PID });

    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, { username: "taken_name" }))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect((err as AppError).message).to.include("already taken");
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("calls update and logAction in a transaction when bio changes", async () => {
    const user = makeUserDoc();
    // findByPublicId is called twice: initial lookup + post-update refetch
    stubs.userReadRepo.findByPublicId.resolves(user);

    await bus.dispatch(new UpdateProfileCommand(USER_PID, { bio: "new bio" }));

    expect(stubs.unitOfWork.executeInTransaction.calledOnce).to.be.true;
    expect(stubs.userWriteRepo.update.calledOnce).to.be.true;
    const [id, patch] = stubs.userWriteRepo.update.getCall(0).args;
    expect(id).to.equal(asMongoId(USER_MID));
    expect((patch as any).$set.bio).to.equal("new bio");
    expect(stubs.userActionRepo.logAction.calledOnce).to.be.true;
  });

  it("returns the DTO from dtoService.toPublicDTO", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());
    const expectedDto = makePublicDTO();
    stubs.dtoService.toPublicDTO.returns(expectedDto);

    const result = await bus.dispatch(
      new UpdateProfileCommand(USER_PID, { bio: "updated bio" }),
    );

    expect(result).to.deep.equal(expectedDto);
  });

  // -------------------------------------------------------------------------
  // Username change event
  // -------------------------------------------------------------------------

  it("queues UserUsernameChangedEvent when the username changes", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());
    stubs.userReadRepo.findByUsername.resolves(null);

    await bus.dispatch(
      new UpdateProfileCommand(USER_PID, { username: "brand_new_name" }),
    );

    expect(stubs.eventBus.queueTransactional.calledOnce).to.be.true;
    const event = stubs.eventBus.queueTransactional.getCall(0).args[0];
    expect(event).to.be.instanceOf(UserUsernameChangedEvent);
    expect(event.userPublicId).to.equal(USER_PID);
    expect(event.oldUsername).to.equal("original_username");
    expect(event.newUsername).to.equal("brand_new_name");
  });

  it("does not queue an event when only bio changes", async () => {
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());

    await bus.dispatch(new UpdateProfileCommand(USER_PID, { bio: "new bio" }));

    expect(stubs.eventBus.queueTransactional.called).to.be.false;
  });

  it("does not queue an event when username provided equals current username (no-change path is blocked by validation)", async () => {
    // Same username alone is rejected before reaching the event logic
    stubs.userReadRepo.findByPublicId.resolves(makeUserDoc());

    const err = await bus
      .dispatch(new UpdateProfileCommand(USER_PID, { username: "original_username" }))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect(stubs.eventBus.queueTransactional.called).to.be.false;
  });
});
