import { afterEach, beforeEach, describe, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import crypto from "crypto";
import sinon, { SinonStub } from "sinon";
import { Model, Types } from "mongoose";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { UserWriteRepository } from "@/repositories/write/UserWriteRepository";
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

describe("User read and write repositories", () => {
	let userReadRepository: UserReadRepository;
	let userWriteRepository: UserWriteRepository;
	let model: MockUserModel;
	let query: MockQuery;

	beforeEach(() => {
		query = createQueryStub();
		model = createUserModel(query);
		const followRepository = {
			getFollowerObjectIds: sinon.stub().resolves([]),
			getFollowingObjectIds: sinon.stub().resolves([]),
		};

		userReadRepository = new UserReadRepository(
			model as unknown as Model<IUser>,
			followRepository as never,
		);
		userWriteRepository = new UserWriteRepository(
			model as unknown as Model<IUser>,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("UserWriteRepository.create", () => {
		const userData: Partial<IUser> = {
			username: "testuser",
			email: "test@example.com",
			password: "password123",
		};

		it("returns the saved user document", async () => {
			const expectedDoc = createUserDoc(userData);
			model.withArgs(userData).returns(expectedDoc);
			expectedDoc.save.resolves(expectedDoc);

			const result = await userWriteRepository.create(userData);

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

			await expect(userWriteRepository.create(userData))
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

			await expect(userWriteRepository.create(userData))
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

			await expect(userWriteRepository.create(userData))
				.to.be.rejectedWith("Operation failed")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});

	describe("UserWriteRepository.update", () => {
		const userId = asMongoId(new Types.ObjectId().toString());
		const updateData = { username: "updatedUser" };
		const updatedUser = { _id: userId, ...updateData } as unknown as IUser;

		it("returns the updated user when found", async () => {
			query.exec.resolves(updatedUser);

			const result = await userWriteRepository.update(userId, updateData);

			expect(result).to.equal(updatedUser);
			expect(model.findOneAndUpdate.calledOnceWith(
				{ _id: userId },
				updateData,
				{ new: true },
			)).to.be.true;
		});

		it("returns null when no user matches", async () => {
			query.exec.resolves(null);

			const result = await userWriteRepository.update(userId, updateData);

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

			await expect(userWriteRepository.update(userId, { username: "existingUser" }))
				.to.be.rejectedWith("username already exists")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DuplicateError");
					return true;
				});
		});

		it("wraps unexpected update failures", async () => {
			query.exec.rejects(new Error("Update failed"));

			await expect(userWriteRepository.update(userId, updateData))
				.to.be.rejectedWith("Update failed")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});

	describe("UserWriteRepository.consumePasswordResetToken", () => {
		it("matches an unexpired token while consuming it in the password update", async () => {
			const updatedUser = { _id: new Types.ObjectId() } as IUser;
			query.exec.resolves(updatedUser);

			const result = await userWriteRepository.consumePasswordResetToken(
				"token-hash",
				"new-password",
			);

			expect(result).to.equal(updatedUser);
			const [filter, update, options] = model.findOneAndUpdate.firstCall.args;
			expect(filter.resetToken).to.equal("token-hash");
			expect(filter.resetTokenExpires.$gt).to.be.instanceOf(Date);
			expect(update).to.deep.equal({
				$set: { password: "new-password" },
				$unset: { resetToken: 1, resetTokenExpires: 1 },
			});
			expect(options).to.deep.equal({ new: true });
		});
	});

	describe("UserReadRepository.findByResetToken", () => {
		it("hashes the supplied token before matching an unexpired reset token", async () => {
			query.exec.resolves(null);

			await userReadRepository.findByResetToken("raw-reset-token");

			const [filter] = model.findOne.firstCall.args;
			expect(filter.resetToken).to.equal(
				crypto
					.createHash("sha256")
					.update("raw-reset-token")
					.digest("hex"),
			);
			expect(filter.resetTokenExpires.$gt).to.be.instanceOf(Date);
		});
	});

	describe("UserReadRepository.getAll", () => {
		const users = [
			{ _id: new Types.ObjectId(), username: "user1" },
			{ _id: new Types.ObjectId(), username: "user2" },
		] as IUser[];

		it("applies default pagination", async () => {
			query.exec.resolves(users);

			const result = await userReadRepository.getAll({});

			expect(result).to.deep.equal(users);
			expect(model.find.calledOnceWith({})).to.be.true;
			expect(query.skip.calledOnceWith(0)).to.be.true;
			expect(query.limit.calledOnceWith(20)).to.be.true;
		});

		it("builds the search query from provided terms", async () => {
			query.exec.resolves(users);

			await userReadRepository.getAll({ search: ["test", "user"], page: 2, limit: 5 });

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

			const result = await userReadRepository.getAll({ search: [""], page: 1, limit: 20 });

			expect(result).to.be.null;
		});

		it("wraps unexpected read failures", async () => {
			query.exec.rejects(new Error("DatabaseError"));

			await expect(userReadRepository.getAll({}))
				.to.be.rejectedWith("DatabaseError")
				.and.eventually.satisfy((error: Error) => {
					expect(error.name).to.equal("DatabaseError");
					return true;
				});
		});
	});
});
