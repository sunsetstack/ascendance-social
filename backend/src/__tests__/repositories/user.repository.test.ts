import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Model, Types } from "mongoose";
import { UserRepository } from "@/repositories/user.repository";
import { IUser } from "@/types";

chai.use(chaiAsPromised);

interface MockUserDoc extends IUser {
	save: SinonStub;
	$session: SinonStub;
	_id: Types.ObjectId;
}

const createMockUserDocInstance = (userData: Partial<IUser>): MockUserDoc => {
	const instance = {
		...userData,
		_id: userData._id || new Types.ObjectId(),
		save: sinon.stub(),
		$session: sinon.stub().returnsThis(),
	} as unknown as MockUserDoc;
	instance.save!.resolves(instance);
	return instance;
};

interface MockUserModelFunc extends SinonStub {
	findOneAndUpdate: SinonStub;
	findOne: SinonStub;
	findByIdAndUpdate: SinonStub;
	find: SinonStub;
	countDocuments: SinonStub;
}

describe("UserRepository", () => {
	let repository: UserRepository;
	let mockModel: MockUserModelFunc;
	let mockSession: ClientSession;
	let mockQuery: {
		session: SinonStub;
		select: SinonStub;
		sort: SinonStub;
		skip: SinonStub;
		limit: SinonStub;
		exec: SinonStub;
	};

	beforeEach(() => {
		mockQuery = {
			session: sinon.stub().returnsThis(),
			select: sinon.stub().returnsThis(),
			sort: sinon.stub().returnsThis(),
			skip: sinon.stub().returnsThis(),
			limit: sinon.stub().returnsThis(),
			exec: sinon.stub(),
		};

		/* 
    
     createStubInstance(User) only stubs the instance methods of the User model(.save, .comparePassword etc), 
     not the static methods(findOne, countDocuments etc). 
     It doesn't stub the constructor either, so I can't use it to call `new User(data)`
      because the stub instance of User is just an object and there's no constructor to call. This is because Mongoose models
      have a specific two part nature: 
       - the model as a constructor: when calling `new UserModel(data)` UserModel acts as a constructor function to create a new doc instance.
       - the model with static methods: UserModel also has static methods like `find`, `findOne` etc 

      sinon.createStubInstance() creates a stubbed instance of the User class, providing an object that looks like a User document but lacks 
       a callable constructor and static methods. It iterates over the prototype methods of `User`(save, validate, comparePassword etc - 
       methods on a document instance) 

     By manually stubbing mockModel = sinon.stub() and then assigning the methods and mockModel.callsFake((data) => createMockUserDocInstance(data));
     the stub becomes a callable constructor (new mockModel(data)) and a holder of the static methods I need. 
     All because the userRepository interacts with the model as both a constructor and as a holder of static methods. 
     
     */
		mockModel = sinon.stub() as MockUserModelFunc;
		// mockModel = sinon.createStubInstance(User); // This won't work
		mockModel.findOneAndUpdate = sinon.stub().returns(mockQuery);
		mockModel.findOne = sinon.stub().returns(mockQuery);
		mockModel.findByIdAndUpdate = sinon.stub().returns(mockQuery);
		mockModel.find = sinon.stub().returns(mockQuery);
		mockModel.countDocuments = sinon.stub().returns(mockQuery); // Oor .resolves(value)

		//This defines what constructor-like behavior the mockModel function has: it returns the pre-fabricated document instances.
		mockModel.callsFake((data) => createMockUserDocInstance(data));

		mockSession = {} as ClientSession;
		const mockFollowRepository = {
			getFollowerObjectIds: sinon.stub().resolves([]),
			getFollowingObjectIds: sinon.stub().resolves([]),
		};
		repository = new UserRepository(mockModel as any as Model<IUser>, mockFollowRepository as any);
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

		it("should create a new user successfully", async () => {
			const expectedDocInstance = createMockUserDocInstance(userData);

			mockModel.withArgs(userData).returns(expectedDocInstance);
			expectedDocInstance.save.resolves(expectedDocInstance as IUser);

			const result = await repository.create(userData);

			expect(mockModel.calledOnceWith(userData)).to.be.true; // mockModel is the constructor

			// The instance returned by the constructor call is `expectedDocInstance` due to `withArgs...returns`
			expect(expectedDocInstance.$session.called).to.be.false;
			expect(expectedDocInstance.save.calledOnce).to.be.true;
			expect(result).to.deep.equal(expectedDocInstance);
		});

		it("should create a user with a session if provided", async () => {
			const expectedDocInstance = createMockUserDocInstance(userData);
			mockModel.withArgs(userData).returns(expectedDocInstance);
			expectedDocInstance.save.resolves(expectedDocInstance as IUser);

			await repository.create(userData, mockSession);

			expect(mockModel.calledOnceWith(userData)).to.be.true;

			expect(expectedDocInstance.$session.calledOnceWith(mockSession)).to.be.true;
			expect(expectedDocInstance.$session.calledBefore(expectedDocInstance.save)).to.be.true;
			expect(expectedDocInstance.save.calledOnce).to.be.true;
		});

		it("should throw DuplicateError for duplicate username (error code 11000)", async () => {
			const duplicateError: any = new Error("Duplicate key error");
			duplicateError.code = 11000;
			duplicateError.keyValue = { username: "testuser" };

			const expectedDocInstance = createMockUserDocInstance(userData);
			mockModel.withArgs(userData).returns(expectedDocInstance);
			expectedDocInstance.save.rejects(duplicateError);
			try {
				await repository.create(userData);
				throw new Error("Expected create() to throw"); // force test failure
			} catch (err: any) {
				expect(err.message).to.equal("username already exists");
				expect(err.name).to.equal("DuplicateError");
				expect(mockModel.calledOnceWith(userData)).to.be.true;
				expect(expectedDocInstance.save.calledOnce).to.be.true;
			}
		});

		it("should throw DuplicateError for duplicate email (error code 11000)", async () => {
			const duplicateError: any = new Error("Duplicate key error");
			duplicateError.code = 11000;
			duplicateError.keyValue = { email: "test@example.com" };

			const expectedDocInstance = createMockUserDocInstance(userData);
			mockModel.withArgs(userData).returns(expectedDocInstance);
			expectedDocInstance.save.rejects(duplicateError);

			try {
				await repository.create(userData);
				throw new Error("Expect create() to throw");
			} catch (err: any) {
				expect(err.message).to.equal("email already exists");
				expect(err.name).to.equal("DuplicateError");
				expect(mockModel.calledOnceWith(userData)).to.be.true;
				expect(expectedDocInstance.save.calledOnce).to.be.true;
			}
		});

		it("should throw DatabaseError for other save failures", async () => {
			const genericDbError = new Error("Operation failed");

			const expectedDocInstance = createMockUserDocInstance(userData);
			mockModel.withArgs(userData).returns(expectedDocInstance);
			expectedDocInstance.save.rejects(genericDbError);
			try {
				await repository.create(userData);
				throw new Error("Expect create() to throw");
			} catch (err: any) {
				expect(err.name).to.equal("DatabaseError");
				expect(mockModel.calledOnceWith(userData)).to.be.true;
				expect(expectedDocInstance.save.calledOnce).to.be.true;
			}
		});
	});

	describe("update", () => {
		const userId = new Types.ObjectId().toString();
		const updateData = { username: "updatedUser" };
		const updatedUserDoc = { _id: userId, ...updateData } as unknown as IUser;

		it("should update a user successfully", async () => {
			mockQuery.exec.resolves(updatedUserDoc);

			const result = await repository.update(userId, updateData);

			expect(mockModel.findOneAndUpdate.calledOnceWith({ _id: userId }, updateData, { new: true })).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.deep.equal(updatedUserDoc);
		});

		it("should use session when updating", async () => {
			mockQuery.exec.resolves(updatedUserDoc);

			await repository.update(userId, updateData, mockSession);

			expect(mockModel.findOneAndUpdate.calledOnce).to.be.true;
			expect(mockQuery.session.calledOnceWith(mockSession)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});

		it("should return null if user to update is not found", async () => {
			mockQuery.exec.resolves(null);
			const result = await repository.update(userId, updateData);
			expect(result).to.be.null;
		});

		it("should throw DuplicateError on update if it encounters a duplicate key error (e.g., unique username)", async () => {
			const duplicateError: any = new Error("Duplicate key error on update");
			duplicateError.code = 11000;
			duplicateError.keyValue = { username: "existingUser" };
			mockQuery.exec.rejects(duplicateError);

			await expect(repository.update(userId, { username: "existingUser" }))
				.to.be.rejectedWith("username already exists")
				.and.eventually.satisfy((err: any) => {
					expect(err.name).to.equal("DuplicateError");
					return true;
				});
		});

		it("should throw DatabaseError for other update failures", async () => {
			const dbError = new Error("Update failed");
			mockQuery.exec.rejects(dbError);

			await expect(repository.update(userId, updateData))
				.to.be.rejectedWith(dbError.message)
				.and.eventually.satisfy((err: any) => {
					expect(err.name).to.equal("DatabaseError");
					return true;
				});
		});
	});

	describe("getAll", () => {
		const mockUsers = [
			{ _id: new Types.ObjectId(), username: "user1" },
			{ _id: new Types.ObjectId(), username: "user2" },
		] as IUser[];

		it("should get all users with default pagination", async () => {
			mockQuery.exec.resolves(mockUsers);
			const options = {};
			const result = await repository.getAll(options);

			expect(mockModel.find.calledOnceWith({})).to.be.true;
			expect(mockQuery.skip.calledOnceWith(0)).to.be.true;
			expect(mockQuery.limit.calledOnceWith(20)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
			expect(result).to.deep.equal(mockUsers);
		});

		it("should apply search terms and custom pagination to getAll", async () => {
			const options = { search: ["test", "user"], page: 2, limit: 5 };
			const expectedMongoQuery = {
				$or: [
					{ username: { $regex: "test", $options: "i" } },
					{ handle: { $regex: "test", $options: "i" } },
					{ username: { $regex: "user", $options: "i" } },
					{ handle: { $regex: "user", $options: "i" } },
				],
			};
			const expectedSkip = (options.page - 1) * options.limit; // 5

			mockQuery.exec.resolves(mockUsers);
			await repository.getAll(options);

			expect(mockModel.find.calledOnceWith(sinon.match(expectedMongoQuery))).to.be.true;
			expect(mockQuery.skip.calledOnceWith(expectedSkip)).to.be.true;
			expect(mockQuery.limit.calledOnceWith(options.limit)).to.be.true;
			expect(mockQuery.exec.calledOnce).to.be.true;
		});

		it("should return null if no users found by getAll", async () => {
			mockQuery.exec.resolves([]); // No users found
			const result = await repository.getAll({
				search: [""],
				page: 1,
				limit: 20,
			});
			expect(result).to.be.null;
		});

		it("should throw DatabaseError on getAll failure", async () => {
			const dbError = new Error("DatabaseError");
			mockQuery.exec.rejects(dbError);
			try {
				await repository.getAll({});
				throw new Error("Expected getAll() to throw");
			} catch (err: any) {
				expect(err).to.be.instanceOf(Error);
				expect(err.name).to.equal("DatabaseError");
			}
		});
	});
});
