import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Types } from "mongoose";
import { TagService } from "@/services/tag.service";

chai.use(chaiAsPromised);

describe("TagService", () => {
	let tagService: TagService;
	let mockTagRepository: {
		findByTags: SinonStub;
		create: SinonStub;
		findOneAndUpdate: SinonStub;
	};
	let mockSession: ClientSession;

	beforeEach(() => {
		mockTagRepository = {
			findByTags: sinon.stub(),
			create: sinon.stub(),
			findOneAndUpdate: sinon.stub(),
		};

		mockSession = {} as ClientSession;

		const mockRedisService = {
			get: sinon.stub().resolves(null),
			set: sinon.stub().resolves(),
		};
		tagService = new TagService(mockTagRepository as any, mockRedisService as any);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("collectTagNames", () => {
		it("should extract hashtags from body text", () => {
			const body = "Hello #world";
			const result = tagService.collectTagNames(body);
			expect(result).to.include("world");
		});

		it("should extract Cyrillic hashtags", () => {
			const body = "Hello #привет #мир";
			const result = tagService.collectTagNames(body);
			expect(result).to.include("привет");
			expect(result).to.include("мир");
		});

		it("should combine extracted tags with explicit tags", () => {
			const body = "Hello #world";
			const explicitTags = ["nature"];
			const result = tagService.collectTagNames(body, explicitTags);
			expect(result).to.include("world");
			expect(result).to.include("nature");
		});
	});

	describe("ensureTagsExist", () => {
		it("should return existing tag IDs when all tags exist", async () => {
			const tagNames = ["nature", "landscape"];
			const existingTags = [
				{ _id: new Types.ObjectId(), tag: "nature", count: 5 },
				{ _id: new Types.ObjectId(), tag: "landscape", count: 3 },
			];

			// findByTags is called once with array
			mockTagRepository.findByTags.resolves(existingTags);

			const result = await tagService.ensureTagsExist(tagNames, mockSession);

			expect(mockTagRepository.findByTags.calledOnce).to.be.true;
			const args = mockTagRepository.findByTags.firstCall.args;
			expect(args[0]).to.have.members(["nature", "landscape"]);

			expect(result).to.have.lengthOf(2);
			expect(result[0]._id.toString()).to.equal(existingTags[0]._id.toString());
			expect(result[1]._id.toString()).to.equal(existingTags[1]._id.toString());
		});

		it("should create new tags when some tags do not exist", async () => {
			const tagNames = ["nature", "sunset"];
			const existingTag = { _id: new Types.ObjectId(), tag: "nature", count: 5 };
			const newTag = { _id: new Types.ObjectId(), tag: "sunset", count: 0 };

			mockTagRepository.findByTags.resolves([existingTag]);
			mockTagRepository.create.resolves(newTag);

			const result = await tagService.ensureTagsExist(tagNames, mockSession);

			expect(mockTagRepository.findByTags.calledOnce).to.be.true;
			expect(mockTagRepository.create.calledOnce).to.be.true;
			expect(result).to.have.lengthOf(2);
		});

		it("should handle empty tag list", async () => {
			const result = await tagService.ensureTagsExist([], mockSession);

			expect(mockTagRepository.findByTags.called).to.be.false;
			expect(mockTagRepository.create.called).to.be.false;
			expect(result).to.be.an("array").that.is.empty;
		});

		it("should normalize tag names to lowercase", async () => {
			const tagNames = ["NaTuRe", "SUNSET"];
			const existingTag = { _id: new Types.ObjectId(), tag: "nature", count: 5 };
			const newTag = { _id: new Types.ObjectId(), tag: "sunset", count: 0 };

			mockTagRepository.findByTags.resolves([existingTag]);
			mockTagRepository.create.resolves(newTag);

			await tagService.ensureTagsExist(tagNames, mockSession);

			// verify it was called with lowercase tags
			expect(mockTagRepository.findByTags.calledOnce).to.be.true;
			const args = mockTagRepository.findByTags.firstCall.args;
			expect(args[0]).to.have.members(["nature", "sunset"]);
		});

		it("should remove duplicate tags", async () => {
			const tagNames = ["nature", "nature", "sunset"];
			const natureTag = { _id: new Types.ObjectId(), tag: "nature", count: 5 };
			const sunsetTag = { _id: new Types.ObjectId(), tag: "sunset", count: 2 };

			mockTagRepository.findByTags.resolves([natureTag, sunsetTag]);

			const result = await tagService.ensureTagsExist(tagNames, mockSession);

			// should only call findByTags once with unique tags
			expect(mockTagRepository.findByTags.calledOnce).to.be.true;
			const args = mockTagRepository.findByTags.firstCall.args;
			expect(args[0]).to.have.members(["nature", "sunset"]);
			expect(result).to.have.lengthOf(2);
		});
	});

	describe("incrementUsage", () => {
		it("should increment usage count for all provided tag IDs", async () => {
			const tagIds = [new Types.ObjectId(), new Types.ObjectId()];

			mockTagRepository.findOneAndUpdate.resolves({});

			await tagService.incrementUsage(tagIds, mockSession);

			expect(mockTagRepository.findOneAndUpdate.calledTwice).to.be.true;
			// verify the $inc: { count: 1 } is in the update
			const firstCall = mockTagRepository.findOneAndUpdate.firstCall;
			expect(firstCall.args[1]).to.deep.include({ $inc: { count: 1 } });
		});

		it("should handle empty tag ID list", async () => {
			await tagService.incrementUsage([], mockSession);

			expect(mockTagRepository.findOneAndUpdate.called).to.be.false;
		});
	});

	describe("decrementUsage", () => {
		it("should decrement usage count for all provided tag IDs", async () => {
			const tagIds = [new Types.ObjectId(), new Types.ObjectId()];

			mockTagRepository.findOneAndUpdate.resolves({});

			await tagService.decrementUsage(tagIds, mockSession);

			expect(mockTagRepository.findOneAndUpdate.calledTwice).to.be.true;
			// verify the $inc: { count: -1 } is in the update
			const firstCall = mockTagRepository.findOneAndUpdate.firstCall;
			expect(firstCall.args[1]).to.deep.include({ $inc: { count: -1 } });
		});

		it("should handle empty tag ID list", async () => {
			await tagService.decrementUsage([], mockSession);

			expect(mockTagRepository.findOneAndUpdate.called).to.be.false;
		});
	});
});
