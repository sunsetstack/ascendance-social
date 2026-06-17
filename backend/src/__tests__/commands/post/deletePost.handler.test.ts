import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Types } from "mongoose";
import { DeletePostCommand } from "@/application/commands/post/deletePost/deletePost.command";
import { DeletePostCommandHandler } from "@/application/commands/post/deletePost/deletePost.handler";

chai.use(chaiAsPromised);

// valid UUID v4 for testing
const VALID_USER_PUBLIC_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_POST_PUBLIC_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

describe("DeletePostCommandHandler", () => {
	let handler: DeletePostCommandHandler;
	let command: DeletePostCommand;
	let mockUnitOfWork: {
		executeInTransaction: SinonStub;
	};
	let mockPostReadRepository: {
		findByPublicId: SinonStub;
	};
	let mockPostWriteRepository: {
		delete: SinonStub;
	};
	let mockUserReadRepository: {
		findByPublicId: SinonStub;
		findById: SinonStub;
	};
	let mockUserWriteRepository: {
		update: SinonStub;
	};
	let mockCommentRepository: {
		deleteCommentsByPostId: SinonStub;
	};
	let mockCommunityMemberRepository: {
		findByCommunityAndUser: SinonStub;
	};
	let mockTagService: {
		decrementUsage: SinonStub;
	};
	let mockImageService: {
		deleteImage: SinonStub;
		removePostAttachmentRecord: SinonStub;
		deleteAttachmentAsset: SinonStub;
	};
	let mockRedisService: {
		invalidateFeed: SinonStub;
		invalidateByTags: SinonStub;
		zrem: SinonStub;
	};
	let mockEventBus: {
		queueTransactional: SinonStub;
		publish: SinonStub;
	};
	let mockSession: ClientSession;

	beforeEach(() => {
		mockUnitOfWork = {
			executeInTransaction: sinon.stub(),
		};

		mockPostReadRepository = {
			findByPublicId: sinon.stub(),
		};

		mockPostWriteRepository = {
			delete: sinon.stub(),
		};

		mockUserReadRepository = {
			findByPublicId: sinon.stub(),
			findById: sinon.stub(),
		};

		mockUserWriteRepository = {
			update: sinon.stub(),
		};

		mockCommentRepository = {
			deleteCommentsByPostId: sinon.stub(),
		};

		mockCommunityMemberRepository = {
			findByCommunityAndUser: sinon.stub(),
		};

		mockTagService = {
			decrementUsage: sinon.stub(),
		};

		mockImageService = {
			deleteImage: sinon.stub(),
			removePostAttachmentRecord: sinon.stub().resolves({ removed: false }),
			deleteAttachmentAsset: sinon.stub().resolves(),
		};

		mockRedisService = {
			invalidateFeed: sinon.stub(),
			invalidateByTags: sinon.stub().resolves(),
			zrem: sinon.stub().resolves(),
		};

		mockEventBus = {
			queueTransactional: sinon.stub(),
			publish: sinon.stub().resolves(),
		};

		mockSession = {} as ClientSession;

		handler = new DeletePostCommandHandler(
			mockUnitOfWork as any,
			mockPostReadRepository as any,
			mockPostWriteRepository as any,
			mockUserReadRepository as any,
			mockUserWriteRepository as any,
			mockCommentRepository as any,
			mockCommunityMemberRepository as any,
			mockTagService as any,
			mockImageService as any,
			mockEventBus as any,
		);

		command = new DeletePostCommand(VALID_POST_PUBLIC_ID, VALID_USER_PUBLIC_ID);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("Command Creation", () => {
		it("should create command with correct properties", () => {
			expect(command.postPublicId).to.equal(VALID_POST_PUBLIC_ID);
			expect(command.requesterPublicId).to.equal(VALID_USER_PUBLIC_ID);
			expect(command.type).to.equal("DeletePostCommand");
		});
	});

	describe("Execute Method", () => {
		it("should throw error when post not found", async () => {
			mockPostReadRepository.findByPublicId.resolves(null);

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await expect(handler.execute(command)).to.be.rejectedWith("Post not found");
		});

		it("should throw error when user not found", async () => {
			const mockUserId = new Types.ObjectId();

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: new Types.ObjectId(),
				tags: [],
				user: mockUserId,
			};

			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockUserReadRepository.findByPublicId.resolves(null);

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await expect(handler.execute(command)).to.be.rejectedWith("User not found");
		});

		it("should delete post successfully with tags and image", async () => {
			const mockUserId = new Types.ObjectId();
			const mockImageId = new Types.ObjectId();
			const mockTagIds = [new Types.ObjectId(), new Types.ObjectId()];

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: mockImageId,
				tags: mockTagIds,
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockTagService.decrementUsage.resolves();
			mockPostWriteRepository.delete.resolves();
			mockImageService.removePostAttachmentRecord.resolves({ removed: true, removedUrl: "http://image" });

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			const result = await handler.execute(command);

			expect(mockPostReadRepository.findByPublicId.calledWith(VALID_POST_PUBLIC_ID)).to.be.true;
			expect(mockUserReadRepository.findByPublicId.calledWith(VALID_USER_PUBLIC_ID)).to.be.true;
			expect(mockImageService.removePostAttachmentRecord.called).to.be.true;
			expect(mockImageService.deleteAttachmentAsset.called).to.be.false;
			expect(mockTagService.decrementUsage.calledOnce).to.be.true;
			expect(mockTagService.decrementUsage.firstCall.args[0]).to.deep.equal(mockTagIds);
			expect(mockPostWriteRepository.delete.called).to.be.true;
			expect(mockCommentRepository.deleteCommentsByPostId.called).to.be.true;
			expect(mockUnitOfWork.executeInTransaction.called).to.be.true;
			expect(result).to.have.property("message");
		});

		it("should handle post without image", async () => {
			const mockUserId = new Types.ObjectId();
			const mockTagIds = [new Types.ObjectId()];

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: null,
				tags: mockTagIds,
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockPostWriteRepository.delete.resolves();
			mockTagService.decrementUsage.resolves();

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await handler.execute(command);

			expect(mockImageService.removePostAttachmentRecord.called).to.be.false;
			expect(mockTagService.decrementUsage.calledOnce).to.be.true;
			expect(mockTagService.decrementUsage.firstCall.args[0]).to.deep.equal(mockTagIds);
			expect(mockPostWriteRepository.delete.called).to.be.true;
		});

		it("should handle post without tags", async () => {
			const mockUserId = new Types.ObjectId();

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: new Types.ObjectId(),
				tags: [],
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockPostWriteRepository.delete.resolves();
			mockImageService.removePostAttachmentRecord.resolves({ removed: true, removedUrl: "http://image" });

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await handler.execute(command);

			expect(mockTagService.decrementUsage.called).to.be.false;
			expect(mockPostWriteRepository.delete.called).to.be.true;
		});

		it("should abort post deletion if image record deletion fails", async () => {
			const mockUserId = new Types.ObjectId();
			const mockTagIds = [new Types.ObjectId()];

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: new Types.ObjectId(),
				tags: mockTagIds,
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockPostWriteRepository.delete.resolves();
			mockTagService.decrementUsage.resolves();
			mockImageService.removePostAttachmentRecord.rejects(new Error("Image service unavailable"));

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await expect(handler.execute(command)).to.be.rejectedWith(
				"Image service unavailable",
			);

			expect(mockPostWriteRepository.delete.called).to.be.false;
			expect(mockTagService.decrementUsage.called).to.be.false;
		});

		it("should queue PostDeletedEvent after successful deletion", async () => {
			const mockUserId = new Types.ObjectId();

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: new Types.ObjectId(),
				tags: [new Types.ObjectId()],
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockTagService.decrementUsage.resolves();
			mockPostWriteRepository.delete.resolves();
			mockImageService.removePostAttachmentRecord.resolves({ removed: true, removedUrl: "http://image" });

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await handler.execute(command);

			expect(mockEventBus.queueTransactional.called).to.be.true;
		});

		it("should not invalidate user feed cache inline after deletion", async () => {
			const mockUserId = new Types.ObjectId();

			const mockUser = {
				_id: mockUserId,
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Test post",
				image: null,
				tags: [],
				user: mockUserId,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockUserReadRepository.findById.resolves(mockUser);
			mockPostReadRepository.findByPublicId.resolves(mockPost);
			mockCommentRepository.deleteCommentsByPostId.resolves();
			mockPostWriteRepository.delete.resolves();

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await handler.execute(command);

			expect(mockRedisService.invalidateByTags.called).to.be.false;
			expect(mockRedisService.zrem.called).to.be.false;
		});
	});
});
