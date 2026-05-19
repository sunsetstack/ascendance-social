import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import { GetFavoritesQueryHandler } from "@/application/queries/favorite/getFavorites/getFavorites.handler";
import { GetFavoritesQuery } from "@/application/queries/favorite/getFavorites/getFavorites.query";
import { asUserPublicId } from "@/types/branded";
import { PostDTO } from "@/types";

chai.use(chaiAsPromised);

describe("GetFavoritesQueryHandler", () => {
	let handler: GetFavoritesQueryHandler;
	let favoriteRepository: {
		findFavoritesByUserId: sinon.SinonStub;
	};
	let userRepository: {
		findInternalIdByPublicId: sinon.SinonStub;
	};
	let dtoService: {
		toPostDTO: sinon.SinonStub;
	};

	beforeEach(() => {
		favoriteRepository = {
			findFavoritesByUserId: sinon.stub(),
		};
		userRepository = {
			findInternalIdByPublicId: sinon.stub(),
		};
		dtoService = {
			toPostDTO: sinon.stub(),
		};

		handler = new GetFavoritesQueryHandler(
			favoriteRepository as any,
			userRepository as any,
			dtoService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("returns mapped favorites with sanitized pagination", async () => {
		const viewerPublicId = asUserPublicId("viewer-1");
		const rawPost = {
			publicId: "post-1",
			toObject: () => ({ publicId: "post-1" }),
		};

		userRepository.findInternalIdByPublicId.resolves("mongo-user-1");
		favoriteRepository.findFavoritesByUserId.resolves({
			data: [rawPost],
			total: 1,
		});
		dtoService.toPostDTO.returns({ publicId: "post-1" } as PostDTO);

		const result = await handler.execute(
			new GetFavoritesQuery(viewerPublicId, 0, 0),
		);

		expect(userRepository.findInternalIdByPublicId.calledOnceWith(viewerPublicId)).to.be.true;
		expect(favoriteRepository.findFavoritesByUserId.calledOnceWith("mongo-user-1", 1, 1)).to.be.true;
		expect(dtoService.toPostDTO.calledOnce).to.be.true;
		expect(result).to.deep.equal({
			data: [{ publicId: "post-1" }],
			total: 1,
			page: 1,
			limit: 1,
			totalPages: 1,
		});
	});

	it("throws when the viewer cannot be resolved", async () => {
		userRepository.findInternalIdByPublicId.resolves(null);

		await expect(
			handler.execute(
				new GetFavoritesQuery(asUserPublicId("missing-user"), 1, 20),
			),
		).to.be.rejectedWith("User");
	});
});
