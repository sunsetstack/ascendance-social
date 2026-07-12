import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Model, Types, Document } from "mongoose";
import { BaseRepository } from "@/repositories/base.repository";
import { asMongoId } from "@/types/branded";

chai.use(chaiAsPromised);

// Mock document interface for testing
interface MockDocumentData {
	name: string;
}

interface MockDocument extends Document {
	name: string;
	save: SinonStub;
	$session: SinonStub;
}

// Test implementation of BaseRepository
class TestRepository extends BaseRepository<MockDocument> {
	constructor(model: Model<MockDocument>) {
		super(model);
	}
}

const createMockDocInstance = (data: Partial<MockDocumentData & { _id?: Types.ObjectId }>): MockDocument => {
	const instance = {
		name: data.name || "test",
		_id: data._id || new Types.ObjectId(),
		save: sinon.stub(),
		$session: sinon.stub().returnsThis(),
		toObject: sinon.stub().returnsThis(),
		toJSON: sinon.stub().returnsThis(),
		isNew: false,
		isModified: sinon.stub().returns(false),
		markModified: sinon.stub(),
		set: sinon.stub(),
		get: sinon.stub(),
		populate: sinon.stub().returnsThis(),
		depopulate: sinon.stub().returnsThis(),
		equals: sinon.stub().returns(true),
		id: data._id?.toString() || new Types.ObjectId().toString(),
	} as unknown as MockDocument;
	instance.save!.resolves(instance);
	return instance;
};

interface MockModel extends SinonStub {
	findByIdAndUpdate: SinonStub;
	findOneAndUpdate: SinonStub;
	findOneAndDelete: SinonStub;
	findById: SinonStub;
	countDocuments: SinonStub;
}

describe("BaseRepository", () => {
	let repository: TestRepository;
	let mockModel: MockModel;
	let mockSession: ClientSession;
	let mockQuery: {
		session: SinonStub;
		select: SinonStub;
		exec: SinonStub;
	};

	beforeEach(() => {
		mockQuery = {
			session: sinon.stub().returnsThis(),
			select: sinon.stub().returnsThis(),
			exec: sinon.stub(),
		};

		mockModel = sinon.stub() as MockModel;
		mockModel.findByIdAndUpdate = sinon.stub().returns(mockQuery);
		mockModel.findOneAndUpdate = sinon.stub().returns(mockQuery);
		mockModel.findOneAndDelete = sinon.stub().returns(mockQuery);
		mockModel.findById = sinon.stub().returns(mockQuery);
		mockModel.countDocuments = sinon.stub().returns(mockQuery);

		mockModel.callsFake((data) => createMockDocInstance(data));

		mockSession = {} as ClientSession;
		repository = new TestRepository(mockModel as any);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("create", () => {
		const testData = { name: "test document" };

		it("should create a new document successfully", async () => {
			const expectedDoc = createMockDocInstance(testData);
			mockModel.withArgs(testData).returns(expectedDoc);
			expectedDoc.save.resolves(expectedDoc);

			const result = await repository.create(testData);

			expect(mockModel.calledOnceWith(testData)).to.be.true;
			expect(expectedDoc.$session.called).to.be.false;
			expect(expectedDoc.save.calledOnce).to.be.true;
			expect(result).to.deep.equal(expectedDoc);
		});

		it("should create a document without binding a session outside UnitOfWork", async () => {
			const expectedDoc = createMockDocInstance(testData);
			mockModel.withArgs(testData).returns(expectedDoc);
			expectedDoc.save.resolves(expectedDoc);

			await repository.create(testData);

			expect(mockModel.calledOnceWith(testData)).to.be.true;
			expect(expectedDoc.$session.called).to.be.false;
			expect(expectedDoc.save.calledOnceWith({ session: undefined })).to.be.true;
		});

		it("should throw DatabaseError on save failure", async () => {
			const saveError = new Error("Save failed");
			const expectedDoc = createMockDocInstance(testData);
			mockModel.withArgs(testData).returns(expectedDoc);
			expectedDoc.save.rejects(saveError);

			try {
				await repository.create(testData);
				throw new Error("Expected create() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(saveError.message);
			}
		});
	});

	describe("update", () => {
		const docId = asMongoId(new Types.ObjectId().toString());
		const updateData = { name: "updated document" };
		const updatedDoc = createMockDocInstance({ _id: new Types.ObjectId(docId), ...updateData });

		it("should update a document successfully", async () => {
			mockQuery.exec.resolves(updatedDoc);

			const result = await repository.update(docId, updateData);

			expect(mockModel.findByIdAndUpdate.calledOnceWith(docId, { $set: updateData }, { new: true })).to.be.true;
			expect(mockQuery.session.called).to.be.false;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.deep.equal(updatedDoc);
		});

		it("should return null if document to update is not found", async () => {
			mockQuery.exec.resolves(null);

			const result = await repository.update(docId, updateData);

			expect(result).to.be.null;
		});

		it("should throw DatabaseError on update failure", async () => {
			const updateError = new Error("Update failed");
			mockQuery.exec.rejects(updateError);

			try {
				await repository.update(docId, updateData);
				throw new Error("Expected update() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(updateError.message);
			}
		});
	});

	describe("delete", () => {
		const docId = asMongoId(new Types.ObjectId().toString());
		const deletedDoc = createMockDocInstance({ _id: new Types.ObjectId(docId), name: "deleted doc" });

		it("should delete a document successfully", async () => {
			mockQuery.exec.resolves(deletedDoc);

			const result = await repository.delete(docId);

			expect(mockModel.findOneAndDelete.calledOnceWith({ _id: docId })).to.be.true;
			expect(mockQuery.session.called).to.be.false;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.be.true;
		});

		it("should return false if document to delete is not found", async () => {
			mockQuery.exec.resolves(null);

			const result = await repository.delete(docId);

			expect(result).to.be.false;
		});

		it("should throw DatabaseError on delete failure", async () => {
			const deleteError = new Error("Delete failed");
			mockQuery.exec.rejects(deleteError);

			try {
				await repository.delete(docId);
				throw new Error("Expected delete() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(deleteError.message);
			}
		});
	});

	describe("findById", () => {
		const docId = asMongoId(new Types.ObjectId().toString());
		const foundDoc = createMockDocInstance({ _id: new Types.ObjectId(docId), name: "found doc" });

		it("should find a document by ID successfully", async () => {
			mockQuery.exec.resolves(foundDoc);

			const result = await repository.findById(docId);

			expect(mockModel.findById.calledOnceWith(docId)).to.be.true;
			expect(mockQuery.session.called).to.be.false;
			expect(mockQuery.select.called).to.be.false;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.deep.equal(foundDoc);
		});

		it("should select password field when option is provided", async () => {
			mockQuery.exec.resolves(foundDoc);

			await repository.findById(docId, { selectPassword: true });

			expect(mockModel.findById.calledOnce).to.be.true;
			expect(mockQuery.select.calledOnceWith("+password")).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});

		it("should return null if document is not found", async () => {
			mockQuery.exec.resolves(null);

			const result = await repository.findById(docId);

			expect(result).to.be.null;
		});

		it("should throw DatabaseError on find failure", async () => {
			const findError = new Error("Find failed");
			mockQuery.exec.rejects(findError);

			try {
				await repository.findById(docId);
				throw new Error("Expected findById() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(findError.message);
			}
		});
	});

	describe("findOneAndUpdate", () => {
		const filter = { name: "test" };
		const update = { $set: { name: "updated" } };
		const updatedDoc = createMockDocInstance({ _id: new Types.ObjectId(), name: "updated" });

		it("should find and update a document successfully", async () => {
			mockQuery.exec.resolves(updatedDoc);

			const result = await repository.findOneAndUpdate(filter, update);

			expect(mockModel.findOneAndUpdate.calledOnceWith(filter, update, { new: true })).to.be.true;
			expect(mockQuery.session.called).to.be.false;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.deep.equal(updatedDoc);
		});

		it("should return null if document is not found", async () => {
			mockQuery.exec.resolves(null);

			const result = await repository.findOneAndUpdate(filter, update);

			expect(result).to.be.null;
		});

		it("should throw DatabaseError on findOneAndUpdate failure", async () => {
			const updateError = new Error("FindOneAndUpdate failed");
			mockQuery.exec.rejects(updateError);

			try {
				await repository.findOneAndUpdate(filter, update);
				throw new Error("Expected findOneAndUpdate() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(updateError.message);
			}
		});
	});

	describe("countDocuments", () => {
		it("should count documents with empty filter successfully", async () => {
			const expectedCount = 42;
			mockQuery.exec.resolves(expectedCount);

			const result = await repository.countDocuments();

			expect(mockModel.countDocuments.calledOnceWith({})).to.be.true;
			expect(mockQuery.session.called).to.be.false;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.equal(expectedCount);
		});

		it("should count documents with custom filter", async () => {
			const filter = { name: "test" };
			const expectedCount = 15;
			mockQuery.exec.resolves(expectedCount);

			const result = await repository.countDocuments(filter);

			expect(mockModel.countDocuments.calledOnceWith(filter)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.equal(expectedCount);
		});

		it("should throw DatabaseError on count failure", async () => {
			const countError = new Error("Count failed");
			mockQuery.exec.rejects(countError);

			try {
				await repository.countDocuments();
				throw new Error("Expected countDocuments() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(err.message).to.equal(countError.message);
			}
		});
	});
});
