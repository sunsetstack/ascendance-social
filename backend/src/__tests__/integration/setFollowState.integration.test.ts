/**
 * SetFollowState command integration tests.
 *
 * Wires the real SetFollowStateCommandHandler to a real CommandBus with
 * sinon-stubbed dependencies (repositories, UnitOfWork, EventBus, Redis).
 *
 * Proves:
 *   - Follow path: correct repository calls, notification event queued
 *   - Unfollow path: different repository calls, no notification event
 *   - No-op requests are handled idempotently without side effects
 *   - Concurrent duplicate/not-found outcomes are normalized into success
 *   - Self-follow: ValidationError thrown before any I/O
 *   - User not found: NotFoundError thrown before any I/O
 *   - Transaction failure: non-AppError wrapped as DatabaseError
 *   - Feed cache invalidation is attempted after the transaction
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { CommandBus } from "@/application/common/buses/command.bus";
import { SetFollowStateCommand } from "@/application/commands/users/setFollowState/setFollowState.command";
import { SetFollowStateCommandHandler } from "@/application/commands/users/setFollowState/setFollowState.handler";
import { AppError, Errors, createError } from "@/utils/errors";
import { asUserPublicId, asMongoId } from "@/types/branded";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

const makeUserDoc = (publicId: string, mongoId: string) => ({
  _id: { toString: () => mongoId },
  publicId: asUserPublicId(publicId),
  username: `user_${publicId}`,
  handle: `@user_${publicId}`,
  avatar: "avatar.png",
});

const makeStubs = () => ({
  userReadRepo: {
    findByPublicId: sinon.stub(),
    findInternalIdByPublicId: sinon.stub(),
  },
  userWriteRepo: {
    update: sinon.stub().resolves(),
    updateFollowingCount: sinon.stub().resolves(),
    updateFollowerCount: sinon.stub().resolves(),
  },
  followRepo: {
    isFollowing: sinon.stub(),
    addFollow: sinon.stub().resolves(),
    removeFollow: sinon.stub().resolves(),
  },
  userActionRepo: {
    logAction: sinon.stub().resolves(),
  },
  unitOfWork: {
    executeInTransaction: sinon
      .stub()
      .callsFake(async (fn: () => Promise<void>) => fn()),
  },
  redisService: {
    invalidateByTags: sinon.stub().resolves(),
  },
  eventBus: {
    queueTransactional: sinon.stub().resolves(),
  },
});

const buildHandler = (stubs: ReturnType<typeof makeStubs>) =>
  new SetFollowStateCommandHandler(
    stubs.unitOfWork as any,
    stubs.followRepo as any,
    stubs.userReadRepo as any,
    stubs.userWriteRepo as any,
    stubs.userActionRepo as any,
    stubs.redisService as any,
    stubs.eventBus as any,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SetFollowStateCommandHandler integration (via CommandBus)", () => {
  let bus: CommandBus;
  let stubs: ReturnType<typeof makeStubs>;

  const FOLLOWER_PID = "follower-pub-01";
  const FOLLOWEE_PID = "followee-pub-02";
  const FOLLOWER_MID = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const FOLLOWEE_MID = "bbbbbbbbbbbbbbbbbbbbbbbb";

  beforeEach(() => {
    stubs = makeStubs();
    bus = new CommandBus();
    bus.register(SetFollowStateCommand, buildHandler(stubs));
  });

  afterEach(() => sinon.restore());

  // -------------------------------------------------------------------------
  // Follow (not yet following)
  // -------------------------------------------------------------------------

  it("returns 'followed' and queues a notification when following a new user", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(result.action).to.equal("followed");
  });

  it("adds a follow record when following a new user", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(stubs.followRepo.addFollow.calledOnce).to.be.true;
    expect(stubs.followRepo.removeFollow.called).to.be.false;
  });

  it("increments follower/following counts when following a new user", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(
      stubs.userWriteRepo.updateFollowingCount.calledWith(
        asMongoId(FOLLOWER_MID),
        1,
      ),
    ).to.be.true;
    expect(
      stubs.userWriteRepo.updateFollowerCount.calledWith(
        asMongoId(FOLLOWEE_MID),
        1,
      ),
    ).to.be.true;
    expect(stubs.userWriteRepo.update.called).to.be.false;
  });

  it("queues a NotificationRequestedEvent when following a new user", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(stubs.eventBus.queueTransactional.calledOnce).to.be.true;
    const event = stubs.eventBus.queueTransactional.getCall(0).args[0];
    expect(event.payload.actionType).to.equal("follow");
    expect(event.payload.actorId).to.equal(asUserPublicId(FOLLOWER_PID));
    expect(event.payload.receiverId).to.equal(asUserPublicId(FOLLOWEE_PID));
  });

  // -------------------------------------------------------------------------
  // Unfollow (already following)
  // -------------------------------------------------------------------------

  it("returns 'unfollowed' and removes the follow record when already following", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(true);

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        false,
      ),
    );

    expect(result.action).to.equal("unfollowed");
    expect(stubs.followRepo.removeFollow.calledOnce).to.be.true;
    expect(stubs.followRepo.addFollow.called).to.be.false;
  });

  it("does not queue a notification event when unfollowing", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(true);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        false,
      ),
    );

    expect(stubs.eventBus.queueTransactional.called).to.be.false;
  });

  it("decrements follower/following counts when unfollowing", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(true);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        false,
      ),
    );

    expect(
      stubs.userWriteRepo.updateFollowingCount.calledWith(
        asMongoId(FOLLOWER_MID),
        -1,
      ),
    ).to.be.true;
    expect(
      stubs.userWriteRepo.updateFollowerCount.calledWith(
        asMongoId(FOLLOWEE_MID),
        -1,
      ),
    ).to.be.true;
    expect(stubs.userWriteRepo.update.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Idempotent no-op paths
  // -------------------------------------------------------------------------

  it("returns 'followed' without side effects when already following", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(true);

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(result.action).to.equal("followed");
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
    expect(stubs.userActionRepo.logAction.called).to.be.false;
    expect(stubs.eventBus.queueTransactional.called).to.be.false;
    expect(stubs.redisService.invalidateByTags.called).to.be.false;
  });

  it("returns 'unfollowed' without side effects when already unfollowed", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        false,
      ),
    );

    expect(result.action).to.equal("unfollowed");
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
    expect(stubs.userActionRepo.logAction.called).to.be.false;
    expect(stubs.eventBus.queueTransactional.called).to.be.false;
    expect(stubs.redisService.invalidateByTags.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Race normalization
  // -------------------------------------------------------------------------

  it("treats a duplicate follow write as a successful no-op when another request already followed", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);
    stubs.followRepo.addFollow.rejects(
      Errors.duplicate("Already following this user"),
    );

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(result.action).to.equal("followed");
    expect(stubs.redisService.invalidateByTags.called).to.be.false;
    expect(stubs.eventBus.queueTransactional.called).to.be.false;
  });

  it("treats a missing follow on unfollow as a successful no-op when another request already removed it", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(true);
    stubs.followRepo.removeFollow.rejects(
      createError("NotFoundError", "Not following this user"),
    );

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        false,
      ),
    );

    expect(result.action).to.equal("unfollowed");
    expect(stubs.redisService.invalidateByTags.called).to.be.false;
    expect(stubs.eventBus.queueTransactional.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Error scenarios
  // -------------------------------------------------------------------------

  it("throws ValidationError (400) when follower and followee are the same user", async () => {
    stubs.userReadRepo.findByPublicId.resolves(
      makeUserDoc(FOLLOWER_PID, FOLLOWER_MID),
    );

    const err = await bus
      .dispatch(
        new SetFollowStateCommand(
          asUserPublicId(FOLLOWER_PID),
          asUserPublicId(FOLLOWER_PID),
          true,
        ),
      )
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(400);
    expect(stubs.followRepo.addFollow.called).to.be.false;
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  it("throws NotFoundError (404) when either user does not exist", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(null);

    const err = await bus
      .dispatch(
        new SetFollowStateCommand(
          asUserPublicId(FOLLOWER_PID),
          asUserPublicId(FOLLOWEE_PID),
          true,
        ),
      )
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.unitOfWork.executeInTransaction.called).to.be.false;
  });

  it("throws DatabaseError (500) when the transaction throws a non-AppError", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);
    stubs.unitOfWork.executeInTransaction.rejects(new Error("connection lost"));

    const err = await bus
      .dispatch(
        new SetFollowStateCommand(
          asUserPublicId(FOLLOWER_PID),
          asUserPublicId(FOLLOWEE_PID),
          true,
        ),
      )
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    const appError = err as AppError;
    expect(appError.statusCode).to.equal(500);
    expect(appError.name).to.equal("DatabaseError");
  });

  // -------------------------------------------------------------------------
  // Post-transaction side effects
  // -------------------------------------------------------------------------

  it("invalidates feed caches after the transaction completes", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);

    await bus.dispatch(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(stubs.redisService.invalidateByTags.calledOnce).to.be.true;
  });

  it("still returns a result when cache invalidation fails (non-critical path)", async () => {
    stubs.userReadRepo.findByPublicId
      .withArgs(asUserPublicId(FOLLOWER_PID))
      .resolves(makeUserDoc(FOLLOWER_PID, FOLLOWER_MID))
      .withArgs(asUserPublicId(FOLLOWEE_PID))
      .resolves(makeUserDoc(FOLLOWEE_PID, FOLLOWEE_MID));
    stubs.followRepo.isFollowing.resolves(false);
    stubs.redisService.invalidateByTags.rejects(new Error("redis down"));

    const result = await bus.dispatch<{ action: string }>(
      new SetFollowStateCommand(
        asUserPublicId(FOLLOWER_PID),
        asUserPublicId(FOLLOWEE_PID),
        true,
      ),
    );

    expect(result.action).to.equal("followed");
  });
});
