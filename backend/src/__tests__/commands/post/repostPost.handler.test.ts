import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Types } from "mongoose";

import { RepostPostCommand } from "@/application/commands/post/repostPost/repostPost.command";
import { RepostPostCommandHandler } from "@/application/commands/post/repostPost/repostPost.handler";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { handleMongoError } from "@/utils/errors";

chai.use(chaiAsPromised);

const VALID_USER_PUBLIC_ID = asUserPublicId("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
const VALID_TARGET_POST_PUBLIC_ID = asPostPublicId("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e");

function translateDuplicateKey(error: Error): Error {
	try {
		handleMongoError(error);
	} catch (translated) {
		return translated as Error;
	}
	throw new Error("duplicate-key translation did not throw");
}

function classifyRepostDuplicate(
	handler: RepostPostCommandHandler,
	metadata: Record<PropertyKey, unknown>,
	user: Types.ObjectId,
	repostOf: Types.ObjectId,
): boolean {
	const raw = Object.assign(new Error("raw duplicate"), {
		code: 11000,
		...metadata,
	});
	const wrapped = new Error("translated duplicate", { cause: raw });
	return (
		handler as unknown as {
			isDuplicateRepostError(
				error: unknown,
				requestedUser: unknown,
				requestedRepostOf: unknown,
			): boolean;
		}
	).isDuplicateRepostError(wrapped, user, repostOf);
}

describe("RepostPostCommandHandler", () => {
	let handler: RepostPostCommandHandler;
	let command: RepostPostCommand;

	let mockUnitOfWork: { executeInTransaction: SinonStub };
	let mockPostReadRepository: {
		findByPublicId: SinonStub;
		findOneByFilter: SinonStub;
		countDocuments: SinonStub;
	};
	let mockPostWriteRepository: { create: SinonStub; updateRepostCount: SinonStub };
	let mockUserReadRepository: { findByPublicId: SinonStub };
	let mockUserWriteRepository: { update: SinonStub };
	let mockDTOService: { toPostDTO: SinonStub };
	let mockEventBus: { queueTransactional: SinonStub };

	beforeEach(() => {
		mockUnitOfWork = { executeInTransaction: sinon.stub() };
		mockPostReadRepository = {
			findByPublicId: sinon.stub(),
			findOneByFilter: sinon.stub(),
			countDocuments: sinon.stub(),
		};
		mockPostWriteRepository = {
			create: sinon.stub(),
			updateRepostCount: sinon.stub(),
		};
		mockUserReadRepository = {
			findByPublicId: sinon.stub(),
		};
		mockUserWriteRepository = { update: sinon.stub().resolves() };
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
			mockUserWriteRepository as any,
			mockDTOService as any,
			mockEventBus as any,
		);

		command = new RepostPostCommand(VALID_USER_PUBLIC_ID, VALID_TARGET_POST_PUBLIC_ID, "nice post");
	});

	afterEach(() => {
		sinon.restore();
	});

	it("throws when userPublicId is invalid", async () => {
		const invalid = new RepostPostCommand(asUserPublicId("not-a-uuid"), VALID_TARGET_POST_PUBLIC_ID);
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

	it("16. translates the configured repost unique-index collision", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const existing = {
			_id: new Types.ObjectId(),
			publicId: "existing-repost-public-id",
			body: "existing repost",
		};
		const rawDuplicate = Object.assign(new Error("repost index collision"), {
			code: 11000,
			keyPattern: { user: 1, repostOf: 1, type: 1 },
			keyValue: { user: userId, repostOf: targetPostId, type: "repost" },
		});
		const translated = translateDuplicateKey(rawDuplicate);
		const evidence = {
			bodyInvocationCount: 0,
			commitInvocationCount: 0,
			abortInvocationCount: 0,
			sessionEndCount: 0,
			semaphoreAcquireCount: 0,
			semaphoreReleaseCount: 0,
			retryClassification: ["duplicate-key:configured-repost-index"],
			finalOutcome: undefined as unknown,
		};

		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			id: userId.toString(),
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
		});
		mockPostReadRepository.findByPublicId.onFirstCall().resolves({
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			author: { publicId: "owner" },
			tags: [],
		});
		mockPostReadRepository.findByPublicId.onSecondCall().resolves(existing);
		mockPostReadRepository.findOneByFilter.resolves(existing);
		mockPostReadRepository.countDocuments.resolves(0);
		mockUnitOfWork.executeInTransaction.rejects(translated);
		mockDTOService.toPostDTO.returns({ publicId: existing.publicId });

		evidence.finalOutcome = await handler.execute(command);

		expect(evidence).to.deep.equal({
			bodyInvocationCount: 0,
			commitInvocationCount: 0,
			abortInvocationCount: 0,
			sessionEndCount: 0,
			semaphoreAcquireCount: 0,
			semaphoreReleaseCount: 0,
			retryClassification: ["duplicate-key:configured-repost-index"],
			finalOutcome: { publicId: existing.publicId },
		});
		expect((translated as Error & { cause?: unknown }).cause).to.equal(
			rawDuplicate,
		);
	});

	it("accepts the exact ordered repost key pattern and key value", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();

		expect(
			classifyRepostDuplicate(
				handler,
				{
					keyPattern: { user: 1, repostOf: 1, type: 1 },
					keyValue: {
						user: userId.toString(),
						repostOf: targetPostId,
						type: "repost",
					},
				},
				userId,
				targetPostId,
			),
		).to.equal(true);
	});

	it("rejects a reordered repost key pattern", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();

		expect(
			classifyRepostDuplicate(
				handler,
				{
					keyPattern: { repostOf: 1, user: 1, type: 1 },
					keyValue: { user: userId, repostOf: targetPostId, type: "repost" },
				},
				userId,
				targetPostId,
			),
		).to.equal(false);
	});

	it("rejects extra, missing, or wrong-direction key pattern fields", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const keyValue = { user: userId, repostOf: targetPostId, type: "repost" };

		for (const keyPattern of [
			{ user: 1, repostOf: 1, type: 1, tenant: 1 },
			{ user: 1, repostOf: 1 },
			{ user: -1, repostOf: 1, type: 1 },
		]) {
			expect(
				classifyRepostDuplicate(
					handler,
					{ keyPattern, keyValue },
					userId,
					targetPostId,
				),
			).to.equal(false);
		}
	});

	it("rejects inherited and unusual enumerable key pattern fields", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const inheritedPattern = Object.assign(
			Object.create({ tenant: 1 }) as Record<string, unknown>,
			{ user: 1, repostOf: 1, type: 1 },
		);
		const symbolPattern: Record<PropertyKey, unknown> = {
			user: 1,
			repostOf: 1,
			type: 1,
		};
		Object.defineProperty(symbolPattern, Symbol("tenant"), {
			value: 1,
			enumerable: true,
		});
		const keyValue = { user: userId, repostOf: targetPostId, type: "repost" };

		for (const keyPattern of [inheritedPattern, symbolPattern]) {
			expect(
				classifyRepostDuplicate(
					handler,
					{ keyPattern, keyValue },
					userId,
					targetPostId,
				),
			).to.equal(false);
		}
	});

	it("rejects extra, missing, or reordered key value fields", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const keyPattern = { user: 1, repostOf: 1, type: 1 };

		for (const keyValue of [
			{ user: userId, repostOf: targetPostId, type: "repost", tenant: "x" },
			{ user: userId, repostOf: targetPostId },
			{ repostOf: targetPostId, user: userId, type: "repost" },
		]) {
			expect(
				classifyRepostDuplicate(
					handler,
					{ keyPattern, keyValue },
					userId,
					targetPostId,
				),
			).to.equal(false);
		}
	});

	it("rejects mismatched IDs and the wrong repost type", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const keyPattern = { user: 1, repostOf: 1, type: 1 };

		for (const keyValue of [
			{ user: new Types.ObjectId(), repostOf: targetPostId, type: "repost" },
			{ user: userId, repostOf: new Types.ObjectId(), type: "repost" },
			{ user: userId, repostOf: targetPostId, type: "post" },
		]) {
			expect(
				classifyRepostDuplicate(
					handler,
					{ keyPattern, keyValue },
					userId,
					targetPostId,
				),
			).to.equal(false);
		}
	});

	it("rejects a message-only duplicate", () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const classify = (
			handler as unknown as {
				isDuplicateRepostError(
					error: unknown,
					requestedUser: unknown,
					requestedRepostOf: unknown,
				): boolean;
			}
		).isDuplicateRepostError.bind(handler);

		expect(
			classify(
				new Error("E11000 duplicate key for repost index"),
				userId,
				targetPostId,
			),
		).to.equal(false);
	});

	it("17. propagates an unrelated E11000 collision unchanged", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const existing = {
			_id: new Types.ObjectId(),
			publicId: "existing-repost-public-id",
			body: "existing repost",
		};
		const rawDuplicate = Object.assign(new Error("slug index collision"), {
			code: 11000,
			keyPattern: { slug: 1 },
			keyValue: { slug: "unrelated-slug" },
		});
		const translated = translateDuplicateKey(rawDuplicate);
		const evidence = {
			bodyInvocationCount: 0,
			commitInvocationCount: 0,
			abortInvocationCount: 0,
			sessionEndCount: 0,
			semaphoreAcquireCount: 0,
			semaphoreReleaseCount: 0,
			retryClassification: ["duplicate-key:unrelated-index"],
			finalOutcome: undefined as unknown,
			finalError: undefined as unknown,
		};

		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			id: userId.toString(),
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
		});
		mockPostReadRepository.findByPublicId.onFirstCall().resolves({
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			author: { publicId: "owner" },
			tags: [],
		});
		mockPostReadRepository.findByPublicId.onSecondCall().resolves(existing);
		mockPostReadRepository.findOneByFilter.resolves(existing);
		mockPostReadRepository.countDocuments.resolves(0);
		mockUnitOfWork.executeInTransaction.rejects(translated);
		mockDTOService.toPostDTO.returns({ publicId: existing.publicId });

		try {
			evidence.finalOutcome = await handler.execute(command);
		} catch (error) {
			evidence.finalError = error;
		}

		expect(
			{
				bodyInvocationCount: evidence.bodyInvocationCount,
				commitInvocationCount: evidence.commitInvocationCount,
				abortInvocationCount: evidence.abortInvocationCount,
				sessionEndCount: evidence.sessionEndCount,
				semaphoreAcquireCount: evidence.semaphoreAcquireCount,
				semaphoreReleaseCount: evidence.semaphoreReleaseCount,
				retryClassification: evidence.retryClassification,
				finalOutcome: evidence.finalOutcome,
				finalError: evidence.finalError,
			},
			JSON.stringify({
				...evidence,
				finalError:
					evidence.finalError instanceof Error
						? {
								name: evidence.finalError.name,
								message: evidence.finalError.message,
							}
						: evidence.finalError,
			}),
		).to.deep.equal({
			bodyInvocationCount: 0,
			commitInvocationCount: 0,
			abortInvocationCount: 0,
			sessionEndCount: 0,
			semaphoreAcquireCount: 0,
			semaphoreReleaseCount: 0,
			retryClassification: ["duplicate-key:unrelated-index"],
			finalOutcome: undefined,
			finalError: translated,
		});
		});

	it("propagates duplicate metadata that does not identify an index", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const rawDuplicate = Object.assign(new Error("incomplete duplicate metadata"), {
			code: 11000,
			keyValue: { user: userId, repostOf: targetPostId, type: "repost" },
		});
		const translated = translateDuplicateKey(rawDuplicate);

		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			id: userId.toString(),
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
		});
		mockPostReadRepository.findByPublicId.onFirstCall().resolves({
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			author: { publicId: "owner" },
			tags: [],
		});
		mockPostReadRepository.countDocuments.resolves(0);
		mockUnitOfWork.executeInTransaction.rejects(translated);

		let finalError: unknown;
		try {
			await handler.execute(command);
		} catch (error) {
			finalError = error;
		}

		expect(finalError).to.equal(translated);
		expect(mockPostReadRepository.findOneByFilter.called).to.equal(false);
	});

	it("propagates the repost index when structured key values do not match", async () => {
		const userId = new Types.ObjectId();
		const targetPostId = new Types.ObjectId();
		const rawDuplicate = Object.assign(new Error("different user's repost collision"), {
			code: 11000,
			keyPattern: { user: 1, repostOf: 1, type: 1 },
			keyValue: {
				user: new Types.ObjectId(),
				repostOf: targetPostId.toString(),
				type: "repost",
			},
		});
		const translated = translateDuplicateKey(rawDuplicate);

		mockUserReadRepository.findByPublicId.resolves({
			_id: userId,
			id: userId.toString(),
			publicId: VALID_USER_PUBLIC_ID,
			handle: "h",
			username: "u",
		});
		mockPostReadRepository.findByPublicId.onFirstCall().resolves({
			_id: targetPostId,
			publicId: VALID_TARGET_POST_PUBLIC_ID,
			author: { publicId: "owner" },
			tags: [],
		});
		mockPostReadRepository.countDocuments.resolves(0);
		mockUnitOfWork.executeInTransaction.rejects(translated);

		let finalError: unknown;
		try {
			await handler.execute(command);
		} catch (error) {
			finalError = error;
		}

		expect(finalError).to.equal(translated);
		expect(mockPostReadRepository.findOneByFilter.called).to.equal(false);
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
		expect(mockUserWriteRepository.update.calledOnce).to.be.true;
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
