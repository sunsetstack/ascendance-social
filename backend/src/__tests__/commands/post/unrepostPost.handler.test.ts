import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Types } from "mongoose";

import { UnrepostPostCommand } from "@/application/commands/post/unrepostPost/unrepostPost.command";
import { UnrepostPostCommandHandler } from "@/application/commands/post/unrepostPost/unrepostPost.handler";
import { asPostPublicId, asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const VALID_USER_PUBLIC_ID = asUserPublicId("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
const VALID_TARGET_POST_PUBLIC_ID = asPostPublicId("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e");

describe("UnrepostPostCommandHandler", () => {
	let handler: UnrepostPostCommandHandler;
	let command: UnrepostPostCommand;

	let mockUnitOfWork: { executeInTransaction: SinonStub };
	let mockPostReadRepository: {
		findByPublicId: SinonStub;
		findOneByFilter: SinonStub;
	};
	let mockPostWriteRepository: { delete: SinonStub; updateRepostCount: SinonStub };
	let mockUserReadRepository: { findByPublicId: SinonStub };
	let mockCommentRepository: { deleteCommentsByPostId: SinonStub };
	let mockEventBus: { publish: SinonStub };

	beforeEach(() => {
		mockUnitOfWork = { executeInTransaction: sinon.stub() };
		mockPostReadRepository = {
			findByPublicId: sinon.stub(),
			findOneByFilter: sinon.stub(),
		};
		mockPostWriteRepository = {
			delete: sinon.stub(),
			updateRepostCount: sinon.stub(),
		};
		mockUserReadRepository = {
			findByPublicId: sinon.stub(),
		};
		mockCommentRepository = {
			deleteCommentsByPostId: sinon.stub(),
		};
		mockEventBus = {
			publish: sinon.stub().resolves(),
		};

		handler = new UnrepostPostCommandHandler(
			mockUnitOfWork as any,
			mockPostReadRepository as any,
			mockPostWriteRepository as any,
			mockUserReadRepository as any,
			mockCommentRepository as any,
			mockEventBus as any,
		);

		command = new UnrepostPostCommand(VALID_USER_PUBLIC_ID, VALID_TARGET_POST_PUBLIC_ID);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("throws when userPublicId is invalid", async () => {
		const invalid = new UnrepostPostCommand(asUserPublicId("not-a-uuid"), VALID_TARGET_POST_PUBLIC_ID);
		await expect(handler.execute(invalid)).to.be.rejectedWith("Invalid userPublicId format");
	});

	it("throws when user not found", async () => {
		mockUserReadRepository.findByPublicId.resolves(null);
		await expect(handler.execute(command)).to.be.rejectedWith(
			`User with publicId ${VALID_USER_PUBLIC_ID} not found`,
		);
	});

	it("throws when target post not found", async () => {
		mockUserReadRepository.findByPublicId.resolves({
			_id: new Types.ObjectId(),
			publicId: VALID_USER_PUBLIC_ID,
		});
		mockPostReadRepository.findByPublicId.resolves(null);

		await expect(handler.execute(command)).to.be.rejectedWith(
			`Post ${VALID_TARGET_POST_PUBLIC_ID} not found`,
		);
	});

	it("throws when user has not reposted the post", async () => {
		const userId = new Types.ObjectId();
		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			publicId: VALID_USER_PUBLIC_ID,
		});
		mockPostReadRepository.findByPublicId.resolves({
			_id: new Types.ObjectId(),
			publicId: VALID_TARGET_POST_PUBLIC_ID,
		});
		mockPostReadRepository.findOneByFilter.resolves(null);

		await expect(handler.execute(command)).to.be.rejectedWith("You have not reposted this post");
	});

	it("deletes repost, decrements count, fires event, returns success", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const repostId = new Types.ObjectId();
		const repostPublicId = "repost-public-id-1234";

		const user = { _id: userId, publicId: VALID_USER_PUBLIC_ID };
		const targetPost = { _id: targetPostId, publicId: VALID_TARGET_POST_PUBLIC_ID };
		const repost = { _id: repostId, publicId: repostPublicId, type: "repost" };

		mockUserReadRepository.findByPublicId.resolves(user);
		mockPostReadRepository.findByPublicId.resolves(targetPost);
		mockPostReadRepository.findOneByFilter.resolves(repost);

		mockUnitOfWork.executeInTransaction.callsFake(async (fn: any) => fn({}));
		mockPostWriteRepository.delete.resolves(true);
		mockCommentRepository.deleteCommentsByPostId.resolves();
		mockPostWriteRepository.updateRepostCount.resolves();

		const result = await handler.execute(command);

		// Verify transaction was used
		expect(mockUnitOfWork.executeInTransaction.calledOnce).to.be.true;

		// Verify repost was deleted
		expect(mockPostWriteRepository.delete.calledWith(repostId.toString())).to.be.true;

		// Verify comments on repost were deleted
		expect(mockCommentRepository.deleteCommentsByPostId.calledWith(repostId.toString())).to.be.true;

		// Verify repost count decremented on target post
		expect(
			mockPostWriteRepository.updateRepostCount.calledWith(targetPostId.toString(), -1),
		).to.be.true;

		// Verify PostDeletedEvent was published
		expect(mockEventBus.publish.calledOnce).to.be.true;
		const event = mockEventBus.publish.firstCall.args[0];
		expect(event.postId).to.equal(repostPublicId);
		expect(event.authorPublicId).to.equal(VALID_USER_PUBLIC_ID);

		// Verify return value
		expect(result).to.deep.equal({ message: "Repost removed successfully" });
	});

	it("queries for repost with correct filter", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();

		const user = { _id: userId, publicId: VALID_USER_PUBLIC_ID };
		const targetPost = { _id: targetPostId, publicId: VALID_TARGET_POST_PUBLIC_ID };

		mockUserReadRepository.findByPublicId.resolves(user);
		mockPostReadRepository.findByPublicId.resolves(targetPost);
		mockPostReadRepository.findOneByFilter.resolves(null);

		await expect(handler.execute(command)).to.be.rejected;

		expect(mockPostReadRepository.findOneByFilter.calledOnce).to.be.true;
		const filter = mockPostReadRepository.findOneByFilter.firstCall.args[0];
		expect(filter.user.toString()).to.equal(userId.toString());
		expect(filter.repostOf.toString()).to.equal(targetPostId.toString());
		expect(filter.type).to.equal("repost");
	});

	it("performs delete and count update within the same transaction", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const repostId = new Types.ObjectId();

		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			publicId: VALID_USER_PUBLIC_ID,
		});
		mockPostReadRepository.findByPublicId.resolves({
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
		});
		mockPostReadRepository.findOneByFilter.resolves({
			_id: repostId,
			publicId: "repost-id",
			type: "repost",
		});

		mockUnitOfWork.executeInTransaction.callsFake(async (fn: any) =>
			fn({ id: "mock-session" }),
		);
		mockPostWriteRepository.delete.resolves(true);
		mockCommentRepository.deleteCommentsByPostId.resolves();
		mockPostWriteRepository.updateRepostCount.resolves();

		await handler.execute(command);

		expect(mockUnitOfWork.executeInTransaction.calledOnce).to.be.true;
		expect(mockPostWriteRepository.delete.calledOnce).to.be.true;
		expect(mockCommentRepository.deleteCommentsByPostId.calledOnce).to.be.true;
		expect(mockPostWriteRepository.updateRepostCount.calledOnce).to.be.true;
	});
});
