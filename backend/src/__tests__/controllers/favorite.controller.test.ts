import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Request, Response } from "express";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { AddFavoriteCommand } from "@/application/commands/favorite/addFavorite/addFavorite.command";
import { RemoveFavoriteCommand } from "@/application/commands/favorite/removeFavorite/removeFavorite.command";
import { GetFavoritesQuery } from "@/application/queries/favorite/getFavorites/getFavorites.query";
import { FavoriteController } from "@/controllers/favorite.controller";
import { DecodedUser, PaginationResult, PostDTO } from "@/types";
import { asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const createDecodedUser = (publicId: string): DecodedUser => ({
	publicId: asUserPublicId(publicId),
	email: "test@example.com",
	handle: "test-handle",
	username: "test-user",
	isAdmin: false,
});

describe("FavoriteController", () => {
	let controller: FavoriteController;
	let commandBus: sinon.SinonStubbedInstance<CommandBus>;
	let queryBus: sinon.SinonStubbedInstance<QueryBus>;
	let res: Partial<Response>;

	const createResponse = (): Partial<Response> => {
		const response: Partial<Response> = {};
		response.status = sinon.stub().returns(response);
		response.send = sinon.stub().returns(response);
		response.json = sinon.stub().returns(response);
		return response;
	};

	beforeEach(() => {
		commandBus = sinon.createStubInstance(CommandBus);
		queryBus = sinon.createStubInstance(QueryBus);
		controller = new FavoriteController(
			commandBus as unknown as CommandBus,
			queryBus as unknown as QueryBus,
		);
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
			commandBus.dispatch.resolves(undefined);

			await controller.addFavorite(req as any, res as Response);

			expect(commandBus.dispatch.calledOnce).to.be.true;
			const command = commandBus.dispatch.firstCall.args[0] as AddFavoriteCommand;
			expect(command).to.be.instanceOf(AddFavoriteCommand);
			expect(command.actorPublicId).to.equal("user-1");
			expect(command.postPublicId).to.equal("post-123");
			expect((res.status as SinonStub).calledWith(204)).to.be.true;
			expect((res.send as SinonStub).calledOnce).to.be.true;
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { params: { publicId: "post-123" } };

			let caught: Error | null = null;
			try {
				await controller.addFavorite(req as any, res as Response);
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
			commandBus.dispatch.resolves(undefined);

			await controller.removeFavorite(req as any, res as Response);

			expect(commandBus.dispatch.calledOnce).to.be.true;
			const command = commandBus.dispatch.firstCall.args[0] as RemoveFavoriteCommand;
			expect(command).to.be.instanceOf(RemoveFavoriteCommand);
			expect(command.actorPublicId).to.equal("user-5");
			expect(command.postPublicId).to.equal("post-999");
			expect((res.status as SinonStub).calledWith(204)).to.be.true;
			expect((res.send as SinonStub).calledOnce).to.be.true;
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { params: { publicId: "post-999" } };

			let caught: Error | null = null;
			try {
				await controller.removeFavorite(req as any, res as Response);
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
			queryBus.execute.resolves(result);

			const req: Partial<Request> = {
				decodedUser: createDecodedUser("user-1"),
				query: {},
			};

			await controller.getFavorites(req as any, res as Response);

			expect(queryBus.execute.calledOnce).to.be.true;
			const query = queryBus.execute.firstCall.args[0] as GetFavoritesQuery;
			expect(query).to.be.instanceOf(GetFavoritesQuery);
			expect(query.viewerPublicId).to.equal("user-1");
			expect(query.page).to.equal(1);
			expect(query.limit).to.equal(20);
			expect((res.status as SinonStub).calledWith(200)).to.be.true;
			expect((res.json as SinonStub).calledWith(result)).to.be.true;
		});

		it("passes pagination params", async () => {
			queryBus.execute.resolves({
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

			await controller.getFavorites(req as any, res as Response);

			const query = queryBus.execute.firstCall.args[0] as GetFavoritesQuery;
			expect(query.viewerPublicId).to.equal("user-1");
			expect(query.page).to.equal(2);
			expect(query.limit).to.equal(10);
		});

		it("bubbles authentication error", async () => {
			const req: Partial<Request> = { query: {} };

			let caught: Error | null = null;
			try {
				await controller.getFavorites(req as any, res as Response);
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
