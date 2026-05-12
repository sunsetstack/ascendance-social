import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStubbedInstance } from "sinon";
import { Types } from "mongoose";
import { FavoriteService } from "@/services/favorite.service";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { UserRepository } from "@/repositories/user.repository";
import { PostRepository } from "@/repositories/post.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DTOService } from "@/services/dto.service";
import { IFavorite, PostDTO } from "@/types";

chai.use(chaiAsPromised);

describe("FavoriteService", () => {
	let service: FavoriteService;
	let favoriteRepository: SinonStubbedInstance<FavoriteRepository>;
	let unitOfWork: SinonStubbedInstance<UnitOfWork>;
	let userRepository: SinonStubbedInstance<UserRepository>;
	let postRepository: SinonStubbedInstance<PostRepository>;
	let dtoService: SinonStubbedInstance<DTOService>;

	beforeEach(() => {
		favoriteRepository = sinon.createStubInstance(FavoriteRepository);
		unitOfWork = sinon.createStubInstance(UnitOfWork);
		userRepository = sinon.createStubInstance(UserRepository);
		postRepository = sinon.createStubInstance(PostRepository);
		dtoService = sinon.createStubInstance(DTOService);

		service = new FavoriteService(
			favoriteRepository as unknown as FavoriteRepository,
			unitOfWork as unknown as UnitOfWork,
			userRepository as unknown as UserRepository,
			postRepository as unknown as PostRepository,
			dtoService as unknown as DTOService,
		);

		unitOfWork.executeInTransaction.callsFake(async (callback) => callback());
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("addFavorite", () => {
		const userId = new Types.ObjectId().toString();
		const postId = new Types.ObjectId().toString();

		it("adds favorite when absent", async () => {
			favoriteRepository.findByUserAndPost.resolves(null);
			favoriteRepository.create.resolves({} as any);

			await service.addFavorite(userId, postId);

			expect(favoriteRepository.findByUserAndPost.calledWith(userId, postId)).to.be.true;
			expect(favoriteRepository.create.calledOnce).to.be.true;
			expect(unitOfWork.executeInTransaction.calledOnce).to.be.true;
		});

		it("throws when favorite exists", async () => {
			const existingFavorite = {
				_id: new Types.ObjectId(),
				userId: new Types.ObjectId(userId),
				postId: new Types.ObjectId(postId),
				createdAt: new Date(),
				updatedAt: new Date(),
			} as unknown as IFavorite;

			favoriteRepository.findByUserAndPost.resolves(existingFavorite);

			await expect(service.addFavorite(userId, postId)).to.be.rejectedWith("Post already in favorites");
		});

		it("propagates transaction errors", async () => {
			const error = new Error("db");
			unitOfWork.executeInTransaction.rejects(error);

			await expect(service.addFavorite(userId, postId)).to.be.rejectedWith("db");
		});
	});

	describe("removeFavorite", () => {
		const userId = new Types.ObjectId().toString();
		const postId = new Types.ObjectId().toString();

		it("removes favorite when present", async () => {
			favoriteRepository.remove.resolves(true);

			await service.removeFavorite(userId, postId);

			expect(favoriteRepository.remove.calledWith(userId, postId)).to.be.true;
			expect(unitOfWork.executeInTransaction.calledOnce).to.be.true;
		});

		it("throws when favorite missing", async () => {
			favoriteRepository.remove.resolves(false);

			await expect(service.removeFavorite(userId, postId)).to.be.rejectedWith("Favorite not found");
		});
	});

	describe("public id adapters", () => {
		const actorPublicId = "user-public";
		const postPublicId = "post-public";
		const internalUserId = new Types.ObjectId().toString();
		const internalPostId = new Types.ObjectId().toString();

		beforeEach(() => {
			userRepository.findInternalIdByPublicId.resolves(internalUserId);
			postRepository.findInternalIdByPublicId.resolves(internalPostId);
		});

		it("delegates to addFavorite", async () => {
			const addFavoriteStub = sinon.stub(service, "addFavorite").resolves();

			await service.addFavoriteByPublicIds(actorPublicId, postPublicId);

			expect(addFavoriteStub.calledWith(internalUserId, internalPostId)).to.be.true;
		});

		it("delegates to removeFavorite", async () => {
			const removeFavoriteStub = sinon.stub(service, "removeFavorite").resolves();

			await service.removeFavoriteByPublicIds(actorPublicId, postPublicId);

			expect(removeFavoriteStub.calledWith(internalUserId, internalPostId)).to.be.true;
		});
	});

	describe("getFavoritesForViewer", () => {
		const viewerPublicId = "viewer-1";
		const internalUserId = new Types.ObjectId().toString();

		beforeEach(() => {
			userRepository.findInternalIdByPublicId.resolves(internalUserId);
		});

		it("returns DTOs with pagination", async () => {
			const rawPost = {
				publicId: "post-1",
				toObject: () => ({ publicId: "post-1" }),
			};

			favoriteRepository.findFavoritesByUserId.resolves({ data: [rawPost as any], total: 1 });
			dtoService.toPostDTO.returns({ publicId: "post-1" } as PostDTO);

			const result = await service.getFavoritesForViewer(viewerPublicId, 1, 20);

			expect(dtoService.toPostDTO.calledOnce).to.be.true;
			expect(result).to.deep.equal({
				data: [{ publicId: "post-1" }],
				total: 1,
				page: 1,
				limit: 20,
				totalPages: 1,
			});
		});

		it("enforces minimum pagination values", async () => {
			favoriteRepository.findFavoritesByUserId.resolves({ data: [], total: 0 });
			dtoService.toPostDTO.returns({} as PostDTO);

			const result = await service.getFavoritesForViewer(viewerPublicId, 0, 0);

			expect(favoriteRepository.findFavoritesByUserId.calledWith(internalUserId, 1, 1)).to.be.true;
			expect(result.page).to.equal(1);
			expect(result.limit).to.equal(1);
		});
	});
});
