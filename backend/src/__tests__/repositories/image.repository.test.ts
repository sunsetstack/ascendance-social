import "reflect-metadata";

import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ImageRepository } from "@/repositories/image.repository";
import { ClientSession, Model, Types } from "mongoose";
import { IImage } from "@/types";

chai.use(chaiAsPromised);

interface MockImageModel {
	findById: SinonStub;
	find: SinonStub;
	countDocuments: SinonStub;
	deleteMany: SinonStub;
	aggregate: SinonStub;
	findByIdAndUpdate: SinonStub;
	findOneAndDelete: SinonStub;
	findOneAndUpdate: SinonStub;

	save: SinonStub;
}

function generateRandomObjectId() {
	return new Types.ObjectId();
}

function generateMockData(index: number, overrides?: Partial<IImage>): Partial<IImage> {
	const defaults: Partial<IImage> = {
		_id: generateRandomObjectId(),
		url: `image-${index}.jpg`,
		publicId: `pid-${index}`,
		user: { id: `user-${index}`, username: `user${index}` } as any,
		createdAt: new Date(),
	};
	return { ...defaults, ...overrides };
}

function createMockImage(partial: Partial<IImage>): Partial<IImage> {
	return {
		_id: partial._id || generateRandomObjectId(),
		url: partial.url || "default.jpg",
		publicId: partial.publicId || "default-public-id",
		user: partial.user || {
			id: generateRandomObjectId(),
			username: "defaultuser",
		},
		createdAt: partial.createdAt || new Date(),
	} as unknown as Partial<IImage>;
}

describe("ImageRepository", () => {
	let repository: ImageRepository;
	let mockModel: MockImageModel;
	let mockSession: ClientSession;

	beforeEach(() => {
		mockModel = {
			findById: sinon.stub(),
			find: sinon.stub(),
			countDocuments: sinon.stub(),
			deleteMany: sinon.stub(),
			aggregate: sinon.stub(),
			findByIdAndUpdate: sinon.stub(),
			findOneAndDelete: sinon.stub(),
			findOneAndUpdate: sinon.stub(),
			save: sinon.stub(),
		};

		mockSession = {} as ClientSession;

		repository = new ImageRepository(mockModel as any as Model<IImage>);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("findById", () => {
		it("should throw ValidationError for invalid ObjectId", async () => {
			const invalidId = "invalid-id";

			try {
				await repository.findById(invalidId);
				throw new Error("Excpect findById to throw");
			} catch (err: any) {
				expect(err.name).to.equal("ValidationError");
				expect(err.message).to.equal("Invalid image ID");
				expect(mockModel.findById.called).to.be.false;
			}
		});

		it("should throw DatabaseError on underlying model failure", async () => {
			const validId = generateRandomObjectId().toString();
			const dbError = new Error("Database connection failed");

			const mockQuery = {
				populate: sinon.stub().returnsThis(),
				session: sinon.stub().returnsThis(),
				exec: sinon.stub().rejects(dbError),
			};
			mockModel.findById.returns(mockQuery);

			await expect(repository.findById(validId)).to.be.rejectedWith("Database connection failed");
			expect(mockModel.findById.calledWith(validId)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});

		it("should return an image with populated fields for valid ID", async () => {
			const mockImage = createMockImage(generateMockData(1)) as IImage;
			const mockId = mockImage._id.toString();

			const mockQuery = {
				populate: sinon.stub().returnsThis(),
				session: sinon.stub().returnsThis(),
				exec: sinon.stub().resolves(mockImage),
			};
			mockModel.findById.withArgs(mockId).returns(mockQuery);

			const result = await repository.findById(mockId);

			expect(result).to.deep.equal(mockImage);
			expect(mockModel.findById.calledOnceWith(mockId)).to.be.true;
			expect(mockQuery.populate.calledWith("user", "publicId handle username avatar")).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;

			expect(mockQuery.session.called).to.be.false;
		});

		it("should use session if provided", async () => {
			const mockImage = createMockImage(generateMockData(1)) as IImage;
			const mockId = mockImage._id.toString();

			const mockQuery = {
				populate: sinon.stub().returnsThis(),
				session: sinon.stub().returnsThis(),
				exec: sinon.stub().resolves(mockImage),
			};
			mockModel.findById.withArgs(mockId).returns(mockQuery);

			const result = await repository.findById(mockId, mockSession);

			expect(result).to.deep.equal(mockImage);
			expect(mockModel.findById.calledOnceWith(mockId)).to.be.true;
			expect(mockQuery.session.calledOnceWith(mockSession)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});

		it("should return null if image not found", async () => {
			const validId = generateRandomObjectId().toString();

			const mockQuery = {
				populate: sinon.stub().returnsThis(),
				session: sinon.stub().returnsThis(),
				exec: sinon.stub().resolves(null),
			};
			mockModel.findById.withArgs(validId).returns(mockQuery);

			const result = await repository.findById(validId);

			expect(result).to.be.null;
			expect(mockModel.findById.calledOnceWith(validId)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});
	});

	// note: findWithPagination and findByUserId methods were removed from ImageRepository
	// these tests are skipped until the methods are re-implemented if needed
});
