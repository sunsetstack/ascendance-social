/**
 * GetFavorites query integration tests.
 *
 * Wires the real GetFavoritesQueryHandler to a real QueryBus with
 * sinon-stubbed repositories and DTOService.
 *
 * Proves:
 *   - Unknown viewer throws NotFoundError
 *   - Empty favorites returns a correct empty-page envelope
 *   - Populated favorites: DTOs are mapped, total/page/limit/totalPages set correctly
 *   - Pagination defaults: undefined page/limit default to page=1 / limit=10
 *   - Custom page and limit flow through to the repository call
 *   - AppError from the user-lookup propagates through the bus unchanged
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { QueryBus } from "@/application/common/buses/query.bus";
import { GetFavoritesQuery } from "@/application/queries/favorite/getFavorites/getFavorites.query";
import { GetFavoritesQueryHandler } from "@/application/queries/favorite/getFavorites/getFavorites.handler";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asMongoId } from "@/types/branded";
import type { PaginationResult, PostDTO } from "@/types";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIEWER_PID = "viewer-pub-01";
const VIEWER_MID = "cccccccccccccccccccccccc";

const makePostDTO = (publicId: string): PostDTO =>
  ({
    publicId,
    content: "test content",
    isFavoritedByViewer: true,
    isLikedByViewer: false,
  }) as unknown as PostDTO;

const makeFakePost = (publicId: string) => ({
  publicId,
  toObject: () => ({ publicId, isFavoritedByViewer: undefined, isLikedByViewer: undefined }),
});

const makeStubs = () => ({
  favoriteRepo: {
    findFavoritesByUserId: sinon.stub(),
  },
  userRepo: {
    findInternalIdByPublicId: sinon.stub(),
  },
  dtoService: {
    toPostDTO: sinon.stub().callsFake((post: { publicId: string }) => makePostDTO(post.publicId)),
  },
});

const buildHandler = (stubs: ReturnType<typeof makeStubs>) =>
  new GetFavoritesQueryHandler(
    stubs.favoriteRepo as any,
    stubs.userRepo as any,
    stubs.dtoService as any,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GetFavoritesQueryHandler integration (via QueryBus)", () => {
  let bus: QueryBus;
  let stubs: ReturnType<typeof makeStubs>;

  beforeEach(() => {
    stubs = makeStubs();
    bus = new QueryBus();
    bus.register(GetFavoritesQuery, buildHandler(stubs));
  });

  afterEach(() => sinon.restore());

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it("throws NotFoundError (404) when the viewer is not found in the database", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(null);

    const err = await bus
      .execute(new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 10))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    // GetFavoritesQueryHandler wraps with wrapError("InternalServerError") — AppError passes through
    expect((err as AppError).statusCode).to.equal(404);
  });

  // -------------------------------------------------------------------------
  // Empty result
  // -------------------------------------------------------------------------

  it("returns an empty-page envelope when the viewer has no favorites", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 10),
    );

    expect(result.data).to.deep.equal([]);
    expect(result.total).to.equal(0);
    expect(result.totalPages).to.equal(0);
    expect(result.page).to.equal(1);
    expect(result.limit).to.equal(10);
  });

  // -------------------------------------------------------------------------
  // Populated result
  // -------------------------------------------------------------------------

  it("maps each favorite post through dtoService and marks isFavoritedByViewer = true", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({
      data: [makeFakePost("post-01"), makeFakePost("post-02")],
      total: 2,
    });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 10),
    );

    expect(result.data).to.have.length(2);
    result.data.forEach((dto) => expect(dto.isFavoritedByViewer).to.be.true);
    expect(stubs.dtoService.toPostDTO.callCount).to.equal(2);
  });

  it("calculates totalPages correctly for a multi-page result", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({
      data: [makeFakePost("post-01"), makeFakePost("post-02"), makeFakePost("post-03")],
      total: 25,
    });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 10),
    );

    expect(result.totalPages).to.equal(3); // ceil(25/10)
    expect(result.total).to.equal(25);
  });

  // -------------------------------------------------------------------------
  // Pagination defaults
  // -------------------------------------------------------------------------

  it("defaults page to 1 and limit to 10 when undefined values are passed", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), undefined, undefined),
    );

    expect(result.page).to.equal(1);
    expect(result.limit).to.equal(10);
    expect(stubs.favoriteRepo.findFavoritesByUserId.getCall(0).args[1]).to.equal(1);
    expect(stubs.favoriteRepo.findFavoritesByUserId.getCall(0).args[2]).to.equal(10);
  });

  it("clamps page to 1 when a negative page value is provided", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), -5, 10),
    );

    expect(result.page).to.equal(1);
  });

  it("clamps limit to 1 when a zero limit value is provided", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    const result = await bus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 0),
    );

    expect(result.limit).to.equal(1);
  });

  it("forwards custom page and limit to the favorite repository", async () => {
    stubs.userRepo.findInternalIdByPublicId.resolves(asMongoId(VIEWER_MID));
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    await bus.execute(new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 3, 20));

    const [, calledPage, calledLimit] =
      stubs.favoriteRepo.findFavoritesByUserId.getCall(0).args;
    expect(calledPage).to.equal(3);
    expect(calledLimit).to.equal(20);
  });

  // -------------------------------------------------------------------------
  // Internal ID forwarded correctly
  // -------------------------------------------------------------------------

  it("uses the internal MongoDB ID (not the publicId) for the repository query", async () => {
    const internalId = asMongoId(VIEWER_MID);
    stubs.userRepo.findInternalIdByPublicId.resolves(internalId);
    stubs.favoriteRepo.findFavoritesByUserId.resolves({ data: [], total: 0 });

    await bus.execute(new GetFavoritesQuery(asUserPublicId(VIEWER_PID), 1, 10));

    expect(stubs.favoriteRepo.findFavoritesByUserId.getCall(0).args[0]).to.equal(internalId);
  });
});
