/**
 * GetPostByPublicId query integration tests.
 *
 * Wires the real GetPostByPublicIdQueryHandler through a real QueryBus with
 * sinon-stubbed I/O dependencies.
 *
 * Proves:
 *   - Post not found: NotFoundError (404)
 *   - Anonymous viewer: DTO returned with no viewer-specific fields populated
 *   - Authenticated viewer: isLikedByViewer, isFavoritedByViewer, isRepostedByViewer
 *   - Viewer not found: viewer fields silently skipped
 *   - canDelete = true when viewer owns the post
 *   - canDelete = true when viewer is a community moderator
 *   - canDelete = false when viewer is neither owner nor moderator
 *   - authorCommunityRole set when the post author is a community admin/moderator
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";

import { QueryBus } from "@/application/common/buses/query.bus";
import { GetPostByPublicIdQuery } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.query";
import { GetPostByPublicIdQueryHandler } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.handler";
import { AppError } from "@/utils/errors";
import { asUserPublicId, asPostPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POST_PID = asPostPublicId("post-pub-01");
const POST_MID = "111111111111111111111111";

const AUTHOR_PID = asUserPublicId("author-pub-01");
const AUTHOR_MID = "222222222222222222222222";

const VIEWER_PID = asUserPublicId("viewer-pub-01");
const VIEWER_MID = "333333333333333333333333";

const COMMUNITY_OID = new mongoose.Types.ObjectId("444444444444444444444444");
const COMMUNITY_MID = COMMUNITY_OID.toString();

// ---------------------------------------------------------------------------
// Fake document factories
// ---------------------------------------------------------------------------

const makePost = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => POST_MID },
  publicId: POST_PID,
  author: {
    _id: { toString: () => AUTHOR_MID },
    publicId: AUTHOR_PID,
  },
  user: { toString: () => AUTHOR_MID },
  communityId: null,
  repostOf: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

const makeStubs = () => ({
  postReadRepo: {
    findByPublicId: sinon.stub(),
    countDocuments: sinon.stub().resolves(0),
  },
  userReadRepo: {
    findInternalIdByPublicId: sinon.stub(),
  },
  favoriteRepo: {
    findByUserAndPost: sinon.stub().resolves(null),
  },
  postLikeRepo: {
    hasUserLiked: sinon.stub().resolves(false),
  },
  communityMemberRepo: {
    findByCommunityAndUser: sinon.stub().resolves(null),
  },
  dtoService: {
    toPostDTO: sinon.stub(),
  },
});

const buildHandler = (stubs: ReturnType<typeof makeStubs>) =>
  new GetPostByPublicIdQueryHandler(
    stubs.postReadRepo as any,
    stubs.userReadRepo as any,
    stubs.favoriteRepo as any,
    stubs.postLikeRepo as any,
    stubs.communityMemberRepo as any,
    stubs.dtoService as any,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GetPostByPublicIdQueryHandler integration (via QueryBus)", () => {
  let bus: QueryBus;
  let stubs: ReturnType<typeof makeStubs>;

  beforeEach(() => {
    stubs = makeStubs();
    bus = new QueryBus();
    bus.register(GetPostByPublicIdQuery, buildHandler(stubs));
  });

  afterEach(() => sinon.restore());

  // -------------------------------------------------------------------------
  // Post not found
  // -------------------------------------------------------------------------

  it("throws NotFoundError (404) when the post does not exist", async () => {
    stubs.postReadRepo.findByPublicId.resolves(null);

    const err = await bus
      .execute(new GetPostByPublicIdQuery(POST_PID))
      .catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    expect((err as AppError).statusCode).to.equal(404);
    expect(stubs.dtoService.toPostDTO.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Anonymous viewer
  // -------------------------------------------------------------------------

  it("returns basic DTO without viewer fields when no viewerPublicId is given", async () => {
    const fakeDto = { publicId: POST_PID, content: "hello" };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);

    const result = await bus.execute(new GetPostByPublicIdQuery(POST_PID));

    expect(result).to.deep.include({ publicId: POST_PID, content: "hello" });
    expect(stubs.userReadRepo.findInternalIdByPublicId.called).to.be.false;
    expect(stubs.postLikeRepo.hasUserLiked.called).to.be.false;
    expect(stubs.favoriteRepo.findByUserAndPost.called).to.be.false;
    expect(stubs.postReadRepo.countDocuments.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Authenticated viewer — viewer fields
  // -------------------------------------------------------------------------

  it("sets isLikedByViewer=true when viewer has liked the post", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);
    stubs.postLikeRepo.hasUserLiked.resolves(true);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.isLikedByViewer).to.be.true;
  });

  it("sets isFavoritedByViewer=true when viewer has favorited the post", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);
    stubs.favoriteRepo.findByUserAndPost.resolves({ _id: "fav-id" });

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.isFavoritedByViewer).to.be.true;
  });

  it("sets isRepostedByViewer=true when viewer has reposted the post", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);
    stubs.postReadRepo.countDocuments.resolves(1);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.isRepostedByViewer).to.be.true;
  });

  it("sets all viewer fields to false when viewer has no interactions", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);
    stubs.postLikeRepo.hasUserLiked.resolves(false);
    stubs.favoriteRepo.findByUserAndPost.resolves(null);
    stubs.postReadRepo.countDocuments.resolves(0);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.isLikedByViewer).to.be.false;
    expect(fakeDto.isFavoritedByViewer).to.be.false;
    expect(fakeDto.isRepostedByViewer).to.be.false;
  });

  it("skips viewer fields silently when viewerPublicId resolves to no user", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(null);

    const result = await bus.execute(
      new GetPostByPublicIdQuery(POST_PID, VIEWER_PID),
    );

    expect(result).to.deep.include({ publicId: POST_PID });
    expect(fakeDto.isLikedByViewer).to.be.undefined;
    expect(stubs.postLikeRepo.hasUserLiked.called).to.be.false;
  });

  // -------------------------------------------------------------------------
  // canDelete
  // -------------------------------------------------------------------------

  it("sets canDelete=true when the viewer is the post author", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    // post author publicId matches viewer
    stubs.postReadRepo.findByPublicId.resolves(
      makePost({ author: { _id: { toString: () => AUTHOR_MID }, publicId: VIEWER_PID } }),
    );
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.canDelete).to.be.true;
  });

  it("sets canDelete=false when viewer is not the owner and not a community moderator", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    // author publicId is different from viewer
    stubs.postReadRepo.findByPublicId.resolves(makePost());
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.canDelete).to.be.false;
  });

  it("sets canDelete=true when viewer is a community moderator and not the owner", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(
      makePost({ communityId: COMMUNITY_OID }),
    );
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.userReadRepo.findInternalIdByPublicId.resolves(VIEWER_MID);

    // author is a regular member
    stubs.communityMemberRepo.findByCommunityAndUser
      .withArgs(COMMUNITY_MID, AUTHOR_MID).resolves(null)
      .withArgs(COMMUNITY_MID, VIEWER_MID).resolves({ role: "moderator" });

    await bus.execute(new GetPostByPublicIdQuery(POST_PID, VIEWER_PID));

    expect(fakeDto.canDelete).to.be.true;
  });

  // -------------------------------------------------------------------------
  // authorCommunityRole
  // -------------------------------------------------------------------------

  it("sets authorCommunityRole when the post author is a community moderator", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(
      makePost({ communityId: COMMUNITY_OID }),
    );
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.communityMemberRepo.findByCommunityAndUser
      .withArgs(COMMUNITY_MID, AUTHOR_MID).resolves({ role: "moderator" });

    // anonymous viewer — author role check still runs
    await bus.execute(new GetPostByPublicIdQuery(POST_PID));

    expect(fakeDto.authorCommunityRole).to.equal("moderator");
  });

  it("does not set authorCommunityRole when the author is a regular community member", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(
      makePost({ communityId: COMMUNITY_OID }),
    );
    stubs.dtoService.toPostDTO.returns(fakeDto);
    stubs.communityMemberRepo.findByCommunityAndUser
      .withArgs(COMMUNITY_MID, AUTHOR_MID).resolves({ role: "member" });

    await bus.execute(new GetPostByPublicIdQuery(POST_PID));

    expect(fakeDto.authorCommunityRole).to.be.undefined;
  });

  it("does not call communityMemberRepository when post has no communityId", async () => {
    const fakeDto: Record<string, unknown> = { publicId: POST_PID };
    stubs.postReadRepo.findByPublicId.resolves(makePost({ communityId: null }));
    stubs.dtoService.toPostDTO.returns(fakeDto);

    await bus.execute(new GetPostByPublicIdQuery(POST_PID));

    expect(stubs.communityMemberRepo.findByCommunityAndUser.called).to.be.false;
  });
});
