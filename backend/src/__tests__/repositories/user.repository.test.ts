import { afterEach, beforeEach, describe, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { Model, Types } from "mongoose";
import { UserRepository } from "@/repositories/user.repository";
import { IUser } from "@/types";
import { asMongoId } from "@/types/branded";

chai.use(chaiAsPromised);

type MockQuery = {
	session: SinonStub;
	select: SinonStub;
	sort: SinonStub;
	skip: SinonStub;
	limit: SinonStub;
	exec: SinonStub;
};

type MockUserDoc = IUser & {
	save: SinonStub;
	$session: SinonStub;
	_id: Types.ObjectId;
};

type MockUserModel = SinonStub & {
	findOneAndUpdate: SinonStub;
	findOne: SinonStub;
	findByIdAndUpdate: SinonStub;
	find: SinonStub;
	countDocuments: SinonStub;
};

const createQueryStub = (): MockQuery => ({
	session: sinon.stub().returnsThis(),
	select: sinon.stub().returnsThis(),
	sort: sinon.stub().returnsThis(),
	skip: sinon.stub().returnsThis(),
	limit: sinon.stub().returnsThis(),
	exec: sinon.stub(),
});

const createUserDoc = (userData: Partial<IUser>): MockUserDoc => {
	const doc = {
		...userData,
		_id: userData._id || new Types.ObjectId(),
		save: sinon.stub(),
		$session: sinon.stub().returnsThis(),
	} as unknown as MockUserDoc;

	doc.save.resolves(doc);
	return doc;
};

const createUserModel = (query: MockQuery): MockUserModel => {
	const model = sinon.stub() as MockUserModel;
	model.findOneAndUpdate = sinon.stub().returns(query);
	model.findOne = sinon.stub().returns(query);
	model.findByIdAndUpdate = sinon.stub().returns(query);
	model.find = sinon.stub().returns(query);
	model.countDocuments = sinon.stub().returns(query);
	model.callsFake((userData) => createUserDoc(userData as Partial<IUser>));
	return model;
};

describe("UserRepository", () => {
	let repository: UserRepository;
	let model: MockUserModel;
	let query: MockQuery;

	beforeEach(() => {
		query = createQueryStub();
		model = createUserModel(query);
		const followRepository = {
			getFollowerObjectIds: sinon.stub().resolves([]),
			getFollowingObjectIds: sinon.stub().resolves([]),
		};

		repository = new UserRepository(
			model as unknown as Model<IUser>,
			followRepository as never,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("create", () => {
		const userData: Partial<IUser> = {
			username: "testuser",
			email: "test@example.com",
			password: "password123",
		};

		it("returns the saved user document", async () => {
			const expectedDoc = createUserDoc(userData);
			model.withArgs(userData).returns(expectedDoc);
			expectedDoc.save.resolves(expectedDoc);

			const result = await repository.create(userData);

			expect(result).to.equal(expectedDoc);
			expect(expectedDoc.save.calledOnce).to.be.true;
		});

		it("maps duplicate username errors", async () => {
			const duplicateError = new Error("Duplicate key error") as Error & {
				code: number;
				keyValue: Record<string, string>;
			};
			duplicateError.code = 11000;
			duplicateError.keyValue = { username: "testuser" };

			const doc = createUserDoc(userData);
			model.withArgs(userData).returns(doc);
			doc.save.rejects(duplicateError);

			await expect(repository.create(userData))
				.to.be.rejectedWith("username already exists")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DuplicateError");
					return true;
				});
		});

		it("maps duplicate email errors", async () => {
			const duplicateError = new Error("Duplicate key error") as Error & {
				code: number;
				keyValue: Record<string, string>;
			};
			duplicateError.code = 11000;
			duplicateError.keyValue = { email: "test@example.com" };

			const doc = createUserDoc(userData);
			model.withArgs(userData).returns(doc);
			doc.save.rejects(duplicateError);

			await expect(repository.create(userData))
				.to.be.rejectedWith("email already exists")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DuplicateError");
					return true;
				});
		});

		it("wraps unexpected save failures", async () => {
			const doc = createUserDoc(userData);
			model.withArgs(userData).returns(doc);
			doc.save.rejects(new Error("Operation failed"));

			await expect(repository.create(userData))
				.to.be.rejectedWith("Operation failed")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});

	describe("update", () => {
		const userId = asMongoId(new Types.ObjectId().toString());
		const updateData = { username: "updatedUser" };
		const updatedUser = { _id: userId, ...updateData } as unknown as IUser;

		it("returns the updated user when found", async () => {
			query.exec.resolves(updatedUser);

			const result = await repository.update(userId, updateData);

			expect(result).to.equal(updatedUser);
			expect(model.findOneAndUpdate.calledOnceWith(
				{ _id: userId },
				updateData,
				{ new: true },
			)).to.be.true;
		});

		it("returns null when no user matches", async () => {
			query.exec.resolves(null);

			const result = await repository.update(userId, updateData);

			expect(result).to.be.null;
		});

		it("maps duplicate key errors during update", async () => {
			const duplicateError = new Error("Duplicate key error on update") as Error & {
				code: number;
				keyValue: Record<string, string>;
			};
			duplicateError.code = 11000;
			duplicateError.keyValue = { username: "existingUser" };
			query.exec.rejects(duplicateError);

			await expect(repository.update(userId, { username: "existingUser" }))
				.to.be.rejectedWith("username already exists")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DuplicateError");
					return true;
				});
		});

		it("wraps unexpected update failures", async () => {
			query.exec.rejects(new Error("Update failed"));

			await expect(repository.update(userId, updateData))
				.to.be.rejectedWith("Update failed")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});

	describe("getAll", () => {
		const users = [
			{ _id: new Types.ObjectId(), username: "user1" },
			{ _id: new Types.ObjectId(), username: "user2" },
		] as IUser[];

		it("applies default pagination", async () => {
			query.exec.resolves(users);

			const result = await repository.getAll({});

			expect(result).to.deep.equal(users);
			expect(model.find.calledOnceWith({})).to.be.true;
			expect(query.skip.calledOnceWith(0)).to.be.true;
			expect(query.limit.calledOnceWith(20)).to.be.true;
		});

		it("builds the search query from provided terms", async () => {
			query.exec.resolves(users);

			await repository.getAll({ search: ["test", "user"], page: 2, limit: 5 });

			expect(model.find.calledOnceWith(sinon.match({
				$or: [
					{ username: { $regex: "test", $options: "i" } },
					{ handle: { $regex: "test", $options: "i" } },
					{ username: { $regex: "user", $options: "i" } },
					{ handle: { $regex: "user", $options: "i" } },
				],
			}))).to.be.true;
			expect(query.skip.calledOnceWith(5)).to.be.true;
			expect(query.limit.calledOnceWith(5)).to.be.true;
		});

		it("returns null when no users are found", async () => {
			query.exec.resolves([]);

			const result = await repository.getAll({ search: [""], page: 1, limit: 20 });

			expect(result).to.be.null;
		});

		it("wraps unexpected read failures", async () => {
			query.exec.rejects(new Error("DatabaseError"));

			await expect(repository.getAll({}))
				.to.be.rejectedWith("DatabaseError")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});
});
