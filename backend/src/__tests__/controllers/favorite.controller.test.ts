import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Request, Response } from "express";
import { FavoriteController } from "@/controllers/favorite.controller";
import { FavoriteService } from "@/services/favorite.service";
import { DecodedUser, PaginationResult, PostDTO } from "@/types";

chai.use(chaiAsPromised);

const createDecodedUser = (publicId: string): DecodedUser => ({
	publicId,
	email: "test@example.com",
	handle: "test-handle",
	username: "test-user",
	isAdmin: false,
});

describe("FavoriteController", () => {
	let controller: FavoriteController;
	let favoriteService: sinon.SinonStubbedInstance<FavoriteService>;
	let res: Partial<Response>;

	const createResponse = (): Partial<Response> => {
		const response: Partial<Response> = {};
		response.status = sinon.stub().returns(response);
		response.send = sinon.stub().returns(response);
		response.json = sinon.stub().returns(response);
		return response;
	};

	beforeEach(() => {
		favoriteService = sinon.createStubInstance(FavoriteService);
		controller = new FavoriteController(favoriteService as unknown as FavoriteService);
		res = createResponse();
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("addFavorite", () => {
		it("calls service with sanitized ids", async () => {
			const req: Partial<Request> = {
				params: { publicId: "post-123.jpg" },
				decodedUser: createDecodedUser("user-1"),
			};
			favoriteService.addFavoriteByPublicIds.resolves();

			await controller.addFavorite(req as Request, res as Response);

			expect(favoriteService.addFavoriteByPublicIds.calledWith("user-1", "post-123")).to.be.true;
			expect((res.status as SinonStub).calledWith(204)).to.be.true;
			expect((res.send as SinonStub).calledOnce).to.be.true;
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { params: { publicId: "post-123" } };

			let caught: Error | null = null;
			try {
				await controller.addFavorite(req as Request, res as Response);
				throw new Error("Expected addFavorite to throw");
			} catch (e: any) {
				caught = e;
			}
			expect(caught).to.not.be.null;
			expect(caught!.name).to.equal("AuthenticationError");
			expect(caught!.message).to.equal("User must be logged in to favorite a post");
		});
	});

	describe("removeFavorite", () => {
		it("calls service with sanitized ids", async () => {
			const req: Partial<Request> = {
				params: { publicId: "post-999.png" },
				decodedUser: createDecodedUser("user-5"),
			};
			favoriteService.removeFavoriteByPublicIds.resolves();

			await controller.removeFavorite(req as Request, res as Response);

			expect(favoriteService.removeFavoriteByPublicIds.calledWith("user-5", "post-999")).to.be.true;
			expect((res.status as SinonStub).calledWith(204)).to.be.true;
			expect((res.send as SinonStub).calledOnce).to.be.true;
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { params: { publicId: "post-999" } };

			let caught: Error | null = null;
			try {
				await controller.removeFavorite(req as Request, res as Response);
				throw new Error("Expected removeFavorite to throw");
			} catch (e: any) {
				caught = e;
			}
			expect(caught).to.not.be.null;
			expect(caught!.name).to.equal("AuthenticationError");
			expect(caught!.message).to.equal("User must be logged in to unfavorite a post");
		});
	});

	describe("getFavorites", () => {
		it("returns favorites from service", async () => {
			const result: PaginationResult<PostDTO> = {
				data: [{ publicId: "post-1" } as unknown as PostDTO],
				page: 1,
				limit: 20,
				total: 1,
				totalPages: 1,
			};
			favoriteService.getFavoritesForViewer.resolves(result);

			const req: Partial<Request> = {
				decodedUser: createDecodedUser("user-1"),
				query: {},
			};

			await controller.getFavorites(req as Request, res as Response);

			expect(favoriteService.getFavoritesForViewer.calledWith("user-1", 1, 20)).to.be.true;
			expect((res.status as SinonStub).calledWith(200)).to.be.true;
			expect((res.json as SinonStub).calledWith(result)).to.be.true;
		});

		it("passes pagination params", async () => {
			favoriteService.getFavoritesForViewer.resolves({
				data: [],
				page: 2,
				limit: 10,
				total: 0,
				totalPages: 0,
			});

			const req: Partial<Request> = {
				decodedUser: createDecodedUser("user-1"),
				query: { page: "2", limit: "10" },
			};

			await controller.getFavorites(req as Request, res as Response);

			expect(favoriteService.getFavoritesForViewer.calledWith("user-1", 2, 10)).to.be.true;
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { query: {} };

			let caught: Error | null = null;
			try {
				await controller.getFavorites(req as Request, res as Response);
				throw new Error("Expected getFavorites to throw");
			} catch (e: any) {
				caught = e;
			}
			expect(caught).to.not.be.null;
			expect(caught!.name).to.equal("AuthenticationError");
			expect(caught!.message).to.equal("User must be logged in to view favorites");
		});
	});
});
