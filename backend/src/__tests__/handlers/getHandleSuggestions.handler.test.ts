import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { GetHandleSuggestionsQueryHandler } from "../../application/queries/users/getHandleSuggestions/getHandleSuggestions.handler";
import { GetHandleSuggestionsQuery } from "../../application/queries/users/getHandleSuggestions/getHandleSuggestions.query";
import type { IUserReadRepository } from "../../repositories/interfaces";
import { DTOService } from "../../services/dto.service";
import { FollowRepository } from "../../repositories/follow.repository";
import { IUser } from "../../types";

describe("GetHandleSuggestionsQueryHandler", () => {
  let handler: GetHandleSuggestionsQueryHandler;
  let userReadRepository: sinon.SinonStubbedInstance<IUserReadRepository>;
  let dtoService: sinon.SinonStubbedInstance<DTOService>;
  let followRepository: sinon.SinonStubbedInstance<FollowRepository>;

  beforeEach(() => {
    userReadRepository = {
      findByPublicId: sinon.stub(),
      findWithPagination: sinon.stub(),
    } as any;

    dtoService = {
      toHandleSuggestionDTO: sinon.stub().callsFake((user) => ({
        publicId: user.publicId,
        username: user.username,
        handle: user.handle,
        avatar: user.avatar,
      })),
    } as any;

    followRepository = {
      getFollowerObjectIds: sinon.stub(),
      getFollowingObjectIds: sinon.stub(),
    } as any;

    handler = new GetHandleSuggestionsQueryHandler(
      userReadRepository,
      dtoService as unknown as DTOService,
      followRepository as unknown as FollowRepository,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should return related matches for mention context", async () => {
    const query = new GetHandleSuggestionsQuery(
      "test",
      "mention",
      5,
      "viewer123",
    );
    const viewer = { _id: "viewerObjectId" };
    const relatedUser = {
      publicId: "u1",
      handle: "testUser",
      username: "Test User",
    } as IUser;

    userReadRepository.findByPublicId
      .withArgs("viewer123")
      .resolves(viewer as any);
    followRepository.getFollowerObjectIds.resolves(["id1"]);
    followRepository.getFollowingObjectIds.resolves(["id2"]);
    userReadRepository.findWithPagination.resolves({
      data: [relatedUser],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await handler.execute(query);

    expect(result).to.have.lengthOf(1);
    expect(result[0].handle).to.equal("testUser");
    expect(userReadRepository.findWithPagination.calledOnce).to.be.true;
  });

  it("should fallback to popular matches if no related matches found and query >= 3 chars", async () => {
    const query = new GetHandleSuggestionsQuery(
      "popular",
      "mention",
      5,
      "viewer123",
    );
    const viewer = { _id: "viewerObjectId" };
    const popularUser = {
      publicId: "u2",
      handle: "popularUser",
      username: "Popular User",
    } as IUser;

    userReadRepository.findByPublicId
      .withArgs("viewer123")
      .resolves(viewer as any);
    followRepository.getFollowerObjectIds.resolves([]);
    followRepository.getFollowingObjectIds.resolves([]);
    // First call (related) returns empty, so it shouldn't be called if we optimize,
    // but logically loadRelatedMatches checks IDs first.

    // Setup findWithPagination for popular fallback
    userReadRepository.findWithPagination.resolves({
      data: [popularUser],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await handler.execute(query);

    expect(result).to.have.lengthOf(1);
    expect(result[0].handle).to.equal("popularUser");
  });

  it("should return empty if no related matches and query < 3 chars", async () => {
    const query = new GetHandleSuggestionsQuery(
      "ab",
      "mention",
      5,
      "viewer123",
    );
    const viewer = { _id: "viewerObjectId" };

    userReadRepository.findByPublicId
      .withArgs("viewer123")
      .resolves(viewer as any);
    followRepository.getFollowerObjectIds.resolves([]);
    followRepository.getFollowingObjectIds.resolves([]);

    const result = await handler.execute(query);

    expect(result).to.have.lengthOf(0);
    // Should NOT call popular matches (findWithPagination for popular)
    // But loadRelatedMatches calls findWithPagination if IDs exist. Here IDs are empty.
    // So findWithPagination should not be called at all.
    expect(userReadRepository.findWithPagination.called).to.be.false;
  });

  it("should return popular matches for search context", async () => {
    const query = new GetHandleSuggestionsQuery("search", "search", 5);
    const popularUser = {
      publicId: "u3",
      handle: "searchResult",
      username: "Search Result",
    } as IUser;

    userReadRepository.findWithPagination.resolves({
      data: [popularUser],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await handler.execute(query);

    expect(result).to.have.lengthOf(1);
    expect(result[0].handle).to.equal("searchResult");
  });

  it("should handle empty search query by returning popular matches", async () => {
    const query = new GetHandleSuggestionsQuery("", "search", 5);
    const popularUser = {
      publicId: "u4",
      handle: "topUser",
      username: "Top User",
    } as IUser;

    userReadRepository.findWithPagination.resolves({
      data: [popularUser],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });

    const result = await handler.execute(query);

    expect(result).to.have.lengthOf(1);
    expect(result[0].handle).to.equal("topUser");
  });
});
