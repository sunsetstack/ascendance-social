import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Types } from "mongoose";

import { RepostPostCommand } from "@/application/commands/post/repostPost/repostPost.command";
import { RepostPostCommandHandler } from "@/application/commands/post/repostPost/repostPost.handler";

chai.use(chaiAsPromised);

const VALID_USER_PUBLIC_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_TARGET_POST_PUBLIC_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

describe("RepostPostCommandHandler", () => {
	let handler: RepostPostCommandHandler;
	let command: RepostPostCommand;

	let mockUnitOfWork: { executeInTransaction: SinonStub };
	let mockPostReadRepository: { findByPublicId: SinonStub; countDocuments: SinonStub };
	let mockPostWriteRepository: { create: SinonStub; updateRepostCount: SinonStub };
	let mockUserReadRepository: { findByPublicId: SinonStub };
	let mockDTOService: { toPostDTO: SinonStub };
	let mockEventBus: { queueTransactional: SinonStub };

	beforeEach(() => {
		mockUnitOfWork = { executeInTransaction: sinon.stub() };
		mockPostReadRepository = {
			findByPublicId: sinon.stub(),
			countDocuments: sinon.stub(),
		};
		mockPostWriteRepository = {
			create: sinon.stub(),
			updateRepostCount: sinon.stub(),
		};
		mockUserReadRepository = {
			findByPublicId: sinon.stub(),
		};
		mockDTOService = {
			toPostDTO: sinon.stub(),
		};
		mockEventBus = {
			queueTransactional: sinon.stub(),
		};

		handler = new RepostPostCommandHandler(
			mockUnitOfWork as any,
			mockPostReadRepository as any,
			mockPostWriteRepository as any,
			mockUserReadRepository as any,
			mockDTOService as any,
			mockEventBus as any,
		);

		command = new RepostPostCommand(VALID_USER_PUBLIC_ID, VALID_TARGET_POST_PUBLIC_ID, "nice post");
	});

	afterEach(() => {
		sinon.restore();
	});

	it("throws when userPublicId is invalid", async () => {
		const invalid = new RepostPostCommand("not-a-uuid", VALID_TARGET_POST_PUBLIC_ID);
		await expect(handler.execute(invalid)).to.be.rejectedWith("Invalid userPublicId format");
	});

	it("throws when user not found", async () => {
		mockUserReadRepository.findByPublicId.resolves(null);
		await expect(handler.execute(command)).to.be.rejectedWith(`User with publicId ${VALID_USER_PUBLIC_ID} not found`);
	});

	it("throws when target post not found", async () => {
		mockUserReadRepository.findByPublicId.resolves({ _id: new Types.ObjectId(), publicId: VALID_USER_PUBLIC_ID });
		mockPostReadRepository.findByPublicId.resolves(null);

		await expect(handler.execute(command)).to.be.rejectedWith(`Post ${VALID_TARGET_POST_PUBLIC_ID} not found`);
	});

	it("throws when duplicate repost exists", async () => {
		const userId = new Types.ObjectId();
		mockUserReadRepository.findByPublicId.resolves({ _id: userId, publicId: VALID_USER_PUBLIC_ID });
		mockPostReadRepository.findByPublicId.resolves({ _id: new Types.ObjectId(), publicId: VALID_TARGET_POST_PUBLIC_ID, author: { publicId: "owner" } });
		mockPostReadRepository.countDocuments.resolves(1);

		await expect(handler.execute(command)).to.be.rejectedWith("Post already reposted by this user");
	});

	it("creates repost, updates repostCount, queues events, returns DTO", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const user = {
			_id: userId,
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
			avatar: "a",
		};
		const targetPost = {
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			body: "hello world",
			author: { publicId: "owner-1" },
			tags: [{ _id: new Types.ObjectId(), tag: "tag1" }, { _id: new Types.ObjectId(), tag: "tag1" }],
		};

		const created = { _id: new Types.ObjectId(), publicId: "new-post-public-id" };
		const hydrated = { ...created, body: "nice post" };

		mockUserReadRepository.findByPublicId.resolves(user);
		mockPostReadRepository.findByPublicId.onFirstCall().resolves(targetPost);
		mockPostReadRepository.countDocuments.resolves(0);

		mockUnitOfWork.executeInTransaction.callsFake(async (fn: any) => fn({}));
		mockPostWriteRepository.create.resolves(created);
		mockPostWriteRepository.updateRepostCount.resolves();

		mockPostReadRepository.findByPublicId.onSecondCall().resolves(hydrated);
		mockDTOService.toPostDTO.returns({ publicId: created.publicId });

		const result = await handler.execute(command);

		expect(mockUnitOfWork.executeInTransaction.calledOnce).to.be.true;
		expect(mockPostWriteRepository.create.calledOnce).to.be.true;
		expect(mockPostWriteRepository.updateRepostCount.calledWith(targetPostId.toString(), 1)).to.be.true;
		// notification + post uploaded
		expect(mockEventBus.queueTransactional.callCount).to.equal(2);
		expect(mockDTOService.toPostDTO.calledWith(hydrated)).to.be.true;
		expect(result).to.deep.equal({ publicId: created.publicId });
	});

	it("does not queue notification when reposting own post", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const user = {
			_id: userId,
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
			avatar: "a",
		};
		const targetPost = {
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			body: "hello world",
			author: { publicId: VALID_USER_PUBLIC_ID },
			tags: [],
		};

		const created = { _id: new Types.ObjectId(), publicId: "new-post-public-id" };
		const hydrated = { ...created, body: "nice post" };

		mockUserReadRepository.findByPublicId.resolves(user);
		mockPostReadRepository.findByPublicId.onFirstCall().resolves(targetPost);
		mockPostReadRepository.countDocuments.resolves(0);

		mockUnitOfWork.executeInTransaction.callsFake(async (fn: any) => fn({}));
		mockPostWriteRepository.create.resolves(created);
		mockPostWriteRepository.updateRepostCount.resolves();
		mockPostReadRepository.findByPublicId.onSecondCall().resolves(hydrated);
		mockDTOService.toPostDTO.returns({ publicId: created.publicId });

		await handler.execute(command);

		// only PostUploadedEvent queued
		expect(mockEventBus.queueTransactional.callCount).to.equal(1);
	});
});
