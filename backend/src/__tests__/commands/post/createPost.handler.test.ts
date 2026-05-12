import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Types } from "mongoose";
import { CreatePostCommand } from "@/application/commands/post/createPost/createPost.command";
import { CreatePostCommandHandler } from "@/application/commands/post/createPost/createPost.handler";

chai.use(chaiAsPromised);

// valid UUID v4 for testing
const VALID_USER_PUBLIC_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_POST_PUBLIC_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_IMAGE_PUBLIC_ID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";

describe("CreatePostCommandHandler", () => {
	let handler: CreatePostCommandHandler;
	let command: CreatePostCommand;
	let mockUnitOfWork: {
		executeInTransaction: SinonStub;
	};
	let mockPostReadRepository: {
		findByPublicId: SinonStub;
	};
	let mockPostWriteRepository: {
		create: SinonStub;
	};
	let mockUserReadRepository: {
		findByPublicId: SinonStub;
	};
	let mockUserWriteRepository: {
		update: SinonStub;
	};
	let mockCommunityRepository: {
		findByPublicId: SinonStub;
		findOneAndUpdate: SinonStub;
	};
	let mockCommunityMemberRepository: {
		findByCommunityAndUser: SinonStub;
	};
	let mockTagService: {
		ensureTagsExist: SinonStub;
		incrementUsage: SinonStub;
		collectTagNames: SinonStub;
	};
	let mockImageService: {
		createPostAttachment: SinonStub;
		deleteImage: SinonStub;
		rollbackUpload: SinonStub;
		uploadImage: SinonStub;
		createImageRecord: SinonStub;
	};
	let mockRedisService: {
		invalidateFeed: SinonStub;
		invalidateByTags: SinonStub;
	};
	let mockEventBus: {
		queueTransactional: SinonStub;
		publish: SinonStub;
	};
	let mockSession: ClientSession;
	let mockDTOService: {
		toPostDTO: SinonStub;
	};

	beforeEach(() => {
		mockUnitOfWork = {
			executeInTransaction: sinon.stub(),
		};

		mockPostReadRepository = {
			findByPublicId: sinon.stub(),
		};

		mockPostWriteRepository = {
			create: sinon.stub(),
		};

		mockUserReadRepository = {
			findByPublicId: sinon.stub(),
		};

		mockUserWriteRepository = {
			update: sinon.stub(),
		};

		mockCommunityRepository = {
			findByPublicId: sinon.stub(),
			findOneAndUpdate: sinon.stub(),
		};

		mockCommunityMemberRepository = {
			findByCommunityAndUser: sinon.stub(),
		};

		mockTagService = {
			ensureTagsExist: sinon.stub(),
			incrementUsage: sinon.stub(),
			collectTagNames: sinon.stub(),
		};

		mockImageService = {
			createPostAttachment: sinon.stub(),
			deleteImage: sinon.stub(),
			rollbackUpload: sinon.stub(),
			uploadImage: sinon.stub(),
			createImageRecord: sinon.stub(),
		};

		mockRedisService = {
			invalidateFeed: sinon.stub(),
			invalidateByTags: sinon.stub(),
		};

		mockEventBus = {
			queueTransactional: sinon.stub(),
			publish: sinon.stub(),
		};

		mockDTOService = {
			toPostDTO: sinon.stub(),
		};

		mockSession = {} as ClientSession;

		handler = new CreatePostCommandHandler(
			mockUnitOfWork as any,
			mockPostReadRepository as any,
			mockPostWriteRepository as any,
			mockUserReadRepository as any,
			mockUserWriteRepository as any,
			mockCommunityRepository as any,
			mockCommunityMemberRepository as any,
			mockTagService as any,
			mockImageService as any,
			mockRedisService as any,
			mockDTOService as any,
			mockEventBus as any,
		);

		command = new CreatePostCommand(
			VALID_USER_PUBLIC_ID,
			"Beautiful sunset at the beach #sunset #beach",
			["nature"],
			"/uploads/sunset.jpg",
			"sunset.jpg",
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("Command Creation", () => {
		it("should create command with correct properties", () => {
			expect(command.userPublicId).to.equal(VALID_USER_PUBLIC_ID);
			expect(command.body).to.equal("Beautiful sunset at the beach #sunset #beach");
			expect(command.tags).to.deep.equal(["nature"]);
			expect(command.imagePath).to.equal("/uploads/sunset.jpg");
			expect(command.imageOriginalName).to.equal("sunset.jpg");
			expect(command.type).to.equal("CreatePostCommand");
		});
	});

	describe("Execute Method", () => {
		it("should throw error when userPublicId format is invalid", async () => {
			const invalidCommand = new CreatePostCommand("invalid-user-id", "Test post", [], "/uploads/test.jpg", "test.jpg");

			await expect(handler.execute(invalidCommand)).to.be.rejectedWith("Invalid userPublicId format");
		});

		it("should throw error when user not found", async () => {
			mockUserReadRepository.findByPublicId.resolves(null);

			await expect(handler.execute(command)).to.be.rejectedWith("User not found");
		});

		it("should create post successfully with image and tags", async () => {
			const mockUser = {
				_id: new Types.ObjectId(),
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockTagIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
			const mockTagDocs = mockTagIds.map((id) => ({ _id: id, tag: "nature" }));

			const mockImageDocId = new Types.ObjectId();
			const mockImageResponse = {
				storagePublicId: "cloudinary-id-123",
				summary: {
					docId: mockImageDocId,
					publicId: VALID_IMAGE_PUBLIC_ID,
					url: "/uploads/img-456.jpg",
					slug: "sunset-beach-1234",
				},
			};

			const mockCreatedPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Beautiful sunset at the beach #sunset #beach",
				user: mockUser._id,
				image: mockImageDocId,
				tags: mockTagIds,
				slug: "sunset-beach-1234",
				likesCount: 0,
				commentsCount: 0,
			};

			const mockHydratedPost = {
				...mockCreatedPost,
				image: {
					_id: mockImageDocId,
					publicId: VALID_IMAGE_PUBLIC_ID,
					url: "/uploads/img-456.jpg",
				},
				tags: mockTagDocs,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockTagService.collectTagNames.returns(["sunset", "beach", "nature"]);
			mockTagService.ensureTagsExist.resolves(mockTagDocs);

			// Mock upload and create record separately
			mockImageService.uploadImage.resolves({ url: "/uploads/img-456.jpg", publicId: "cloudinary-id-123" });
			mockImageService.createImageRecord.resolves(mockImageResponse);

			mockPostWriteRepository.create.resolves(mockCreatedPost);
			mockPostReadRepository.findByPublicId.resolves(mockHydratedPost);

			const mockPostDTO = {
				publicId: VALID_POST_PUBLIC_ID,
				body: "Beautiful sunset at the beach #sunset #beach",
				slug: "sunset-beach-1234",
				likesCount: 0,
				commentsCount: 0,
				user: { publicId: VALID_USER_PUBLIC_ID },
				image: { publicId: VALID_IMAGE_PUBLIC_ID, url: "/uploads/img-456.jpg" },
				tags: [{ tag: "nature" }],
				createdAt: new Date(),
			};

			mockDTOService.toPostDTO.resolves(mockPostDTO);

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			const result = await handler.execute(command);

			expect(mockUserReadRepository.findByPublicId.calledWith(VALID_USER_PUBLIC_ID)).to.be.true;
			expect(mockTagService.collectTagNames.called).to.be.true;
			expect(mockTagService.ensureTagsExist.called).to.be.true;

			expect(mockImageService.uploadImage.called).to.be.true;
			expect(mockImageService.createImageRecord.called).to.be.true;

			expect(mockPostWriteRepository.create.called).to.be.true;
			expect(mockUnitOfWork.executeInTransaction.called).to.be.true;
			expect(mockDTOService.toPostDTO.calledWith(mockHydratedPost)).to.be.true;
			expect(result).to.equal(mockPostDTO);
		});

		it("should queue PostUploadedEvent after successful creation", async () => {
			const mockUser = {
				_id: new Types.ObjectId(),
				publicId: VALID_USER_PUBLIC_ID,
			};

			const mockTagIds = [new Types.ObjectId()];
			const mockTagDocs = mockTagIds.map((id) => ({ _id: id, tag: "nature" }));

			const docId = new Types.ObjectId();
			const publicId = VALID_IMAGE_PUBLIC_ID;
			const url = "/uploads/img-456.jpg";
			const slug = "sunset-1234";

			const mockImageSummary = {
				storagePublicId: "cloudinary-id-123",
				summary: { docId, publicId, url, slug },
			};

			const mockCreatedPost = {
				_id: new Types.ObjectId(),
				publicId: VALID_POST_PUBLIC_ID,
				body: "Beautiful sunset",
				user: mockUser._id,
				image: docId,
				tags: mockTagIds,
				slug: "sunset-1234",
				likesCount: 0,
				commentsCount: 0,
			};

			const mockHydratedPost = {
				...mockCreatedPost,
				image: {
					_id: docId,
					publicId,
					url,
				},
				tags: mockTagDocs,
			};

			mockUserReadRepository.findByPublicId.resolves(mockUser);
			mockTagService.collectTagNames.returns(["nature"]);
			mockTagService.ensureTagsExist.resolves(mockTagDocs);

			mockImageService.uploadImage.resolves({ url, publicId: "cloudinary-id-123" });
			mockImageService.createImageRecord.resolves(mockImageSummary);

			mockPostWriteRepository.create.resolves(mockCreatedPost);
			mockPostReadRepository.findByPublicId.resolves(mockHydratedPost);

			mockUnitOfWork.executeInTransaction.callsFake(async (callback) => {
				return await callback(mockSession);
			});

			await handler.execute(command);

			expect(mockEventBus.queueTransactional.calledOnce).to.be.true;
		});
	});
});
