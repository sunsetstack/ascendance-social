/**
 * AddFavorite + RemoveFavorite command integration tests.
 *
 * Wires real handlers through a real CommandBus with sinon-stubbed repositories.
 *
 * AddFavorite proves:
 *   - User not found: NotFoundError (404) — AppError passes through wrapError
 *   - Post not found: NotFoundError (404)
 *   - Duplicate favorite: ConflictError (409) — Errors.duplicate passes through wrapError
 *   - Happy path: creates favorite record
 *   - Unexpected error: wrapped as InternalServerError (500)
 *
 * RemoveFavorite proves:
 *   - User not found: NotFoundError (404)
 *   - Post not found: NotFoundError (404)
 *   - Favorite record not found (wasRemoved=false): NotFoundError (404)
 *   - Happy path: calls favoriteRepository.remove
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { CommandBus } from "@/application/common/buses/command.bus";
import { AddFavoriteCommand } from "@/application/commands/favorite/addFavorite/addFavorite.command";
import { AddFavoriteCommandHandler } from "@/application/commands/favorite/addFavorite/addFavorite.handler";
import { RemoveFavoriteCommand } from "@/application/commands/favorite/removeFavorite/removeFavorite.command";
import { RemoveFavoriteCommandHandler } from "@/application/commands/favorite/removeFavorite/removeFavorite.handler";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asPostPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTOR_PID = asUserPublicId("actor-pub-01");
const ACTOR_MID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const POST_PID = asPostPublicId("post-pub-01");
const POST_MID = "bbbbbbbbbbbbbbbbbbbbbbbb";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

const makeAddStubs = () => ({
  favoriteRepo: {
    findByUserAndPost: sinon.stub().resolves(null),
    create: sinon.stub().resolves(),
  },
  unitOfWork: {
    executeInTransaction: sinon.stub().callsFake(async (fn: () => Promise<void>) => fn()),
  },
  userRepo: {
    findInternalIdByPublicId: sinon.stub().resolves(ACTOR_MID),
  },
  postRepo: {
    findInternalIdByPublicId: sinon.stub().resolves(POST_MID),
  },
});

const makeRemoveStubs = () => ({
  favoriteRepo: {
    remove: sinon.stub().resolves(true),
  },
  unitOfWork: {
    executeInTransaction: sinon.stub().callsFake(async (fn: () => Promise<void>) => fn()),
  },
  userRepo: {
    findInternalIdByPublicId: sinon.stub().resolves(ACTOR_MID),
  },
  postRepo: {
    findInternalIdByPublicId: sinon.stub().resolves(POST_MID),
  },
});

const buildAddHandler = (stubs: ReturnType<typeof makeAddStubs>) =>
  new AddFavoriteCommandHandler(
    stubs.favoriteRepo as any,
    stubs.unitOfWork as any,
    stubs.userRepo as any,
    stubs.postRepo as any,
  );

const buildRemoveHandler = (stubs: ReturnType<typeof makeRemoveStubs>) =>
  new RemoveFavoriteCommandHandler(
    stubs.favoriteRepo as any,
    stubs.unitOfWork as any,
    stubs.userRepo as any,
    stubs.postRepo as any,
  );

// ---------------------------------------------------------------------------
// AddFavorite tests
// ---------------------------------------------------------------------------

describe("AddFavoriteCommandHandler integration (via CommandBus)", () => {
  let bus: CommandBus;
  let stubs: ReturnType<typeof makeAddStubs>;

  beforeEach(() => {
    stubs = makeAddStubs();
    bus = new CommandBus();
    bus.register(AddFavoriteCommand, buildAddHandler(stubs));
  });

  afterEach(() => sinon.restore());

  it("creates a favorite record when actor and post exist and no duplicate", async () => {
    await bus.dispatch(new AddFavoriteCommand(ACTOR_PID, POST_PID));

    expect(stubs.favoriteRepo.create.calledOnce).to.be.true;
    const [favoriteData] = stubs.favoriteRepo.create.getCall(0).args;
    expect(favoriteData.userId.toString()).to.equal(ACTOR_MID);
    expect(favoriteData.postId.toString()).to.equal(POST_MID);
  });

  it("throws NotFoundError (404) when the user does not exist", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(null);

    const err = await bus
      .dispatch(new AddFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.favoriteRepo.create.called).to.be.false;
  });

  it("throws NotFoundError (404) when the post does not exist", async () => {
    stubs.postRepo.findInternalIdByPublicId.resolves(null);

    const err = await bus
      .dispatch(new AddFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.favoriteRepo.create.called).to.be.false;
  });

  it("throws ConflictError (409) when the post is already in favorites", async () => {
    stubs.favoriteRepo.findByUserAndPost.resolves({ _id: "existing-fav" });

    const err = await bus
      .dispatch(new AddFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(409);
    expect(stubs.favoriteRepo.create.called).to.be.false;
  });

  it("wraps unexpected errors as InternalServerError (500)", async () => {
    stubs.unitOfWork.executeInTransaction.rejects(new Error("disk full"));

    const err = await bus
      .dispatch(new AddFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(500);
  });
});

// ---------------------------------------------------------------------------
// RemoveFavorite tests
// ---------------------------------------------------------------------------

describe("RemoveFavoriteCommandHandler integration (via CommandBus)", () => {
  let bus: CommandBus;
  let stubs: ReturnType<typeof makeRemoveStubs>;

  beforeEach(() => {
    stubs = makeRemoveStubs();
    bus = new CommandBus();
    bus.register(RemoveFavoriteCommand, buildRemoveHandler(stubs));
  });

  afterEach(() => sinon.restore());

  it("calls favoriteRepository.remove when actor, post, and favorite record exist", async () => {
    await bus.dispatch(new RemoveFavoriteCommand(ACTOR_PID, POST_PID));

    expect(stubs.favoriteRepo.remove.calledOnce).to.be.true;
    expect(stubs.favoriteRepo.remove.calledWith(ACTOR_MID, POST_MID)).to.be.true;
  });

  it("throws NotFoundError (404) when the user does not exist", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(null);

    const err = await bus
      .dispatch(new RemoveFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.favoriteRepo.remove.called).to.be.false;
  });

  it("throws NotFoundError (404) when the post does not exist", async () => {
    stubs.postRepo.findInternalIdByPublicId.resolves(null);

    const err = await bus
      .dispatch(new RemoveFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.favoriteRepo.remove.called).to.be.false;
  });

  it("throws NotFoundError (404) when the favorite record does not exist", async () => {
    stubs.favoriteRepo.remove.resolves(false);

    const err = await bus
      .dispatch(new RemoveFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
  });

  it("wraps unexpected errors as InternalServerError (500)", async () => {
    stubs.unitOfWork.executeInTransaction.rejects(new Error("network timeout"));

    const err = await bus
      .dispatch(new RemoveFavoriteCommand(ACTOR_PID, POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(500);
  });
});
