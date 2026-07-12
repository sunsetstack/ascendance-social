import "reflect-metadata";

import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { FollowRepository } from "@/repositories/follow.repository";
import { ClientSession, Model, Types } from "mongoose";
import { IFollow } from "@/types";
import { sessionALS } from "@/database/UnitOfWork";
import {
	asMongoId,
	asUserPublicId,
	type MongoId,
} from "@/types/branded";

chai.use(chaiAsPromised);

interface MockFollowModel {
	findOne: SinonStub;
	create: SinonStub;
	deleteOne: SinonStub;
	db: {
		collection: SinonStub;
	};
	save: SinonStub;
}

interface MockUsersCollection {
	findOne: SinonStub;
}

function generateRandomObjectId(): Types.ObjectId & { toString(): MongoId } {
	return new Types.ObjectId() as Types.ObjectId & { toString(): MongoId };
}

function generateMockFollow(overrides?: Partial<IFollow>): Partial<IFollow> {
	const defaults: Partial<IFollow> = {
		_id: generateRandomObjectId(),
		followerId: generateRandomObjectId(),
		followeeId: generateRandomObjectId(),
		timestamp: new Date(),
	};
	return { ...defaults, ...overrides };
}

describe("FollowRepository", () => {
	let repository: FollowRepository;
	let mockModel: MockFollowModel;
	let mockUsersCollection: MockUsersCollection;
	let mockSession: ClientSession;

	beforeEach(() => {
		// Create mock users collection
		mockUsersCollection = {
			findOne: sinon.stub(),
		};

		// Create mock model with all required methods
		mockModel = {
			findOne: sinon.stub(),
			create: sinon.stub(),
			deleteOne: sinon.stub(),
			db: {
				collection: sinon.stub().withArgs("users").returns(mockUsersCollection),
			},
			save: sinon.stub(),
		};

		mockSession = {} as ClientSession;

		// Create repository with mocked model
		repository = new FollowRepository(mockModel as unknown as Model<IFollow>);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("isFollowing", () => {
		it("should return true when follow relationship exists", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const mockFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			mockModel.findOne.resolves(mockFollow);

			const result = await repository.isFollowing(followerId, followeeId);

			expect(result).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
		});

		it("should return false when follow relationship does not exist", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());

			mockModel.findOne.resolves(null);

			const result = await repository.isFollowing(followerId, followeeId);

			expect(result).to.be.false;
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
		});
	});

	describe("isFollowingByPublicId", () => {
		it("should return true when follow relationship exists using publicIds", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const mockFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			mockModel.findOne.resolves(mockFollow);

			const result = await repository.isFollowingByPublicId(followerPublicId, followeePublicId);

			expect(result).to.be.true;
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
		});

		it("should return false when follower user does not exist", async () => {
			const followerPublicId = asUserPublicId("nonexistent-follower");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followeeId = generateRandomObjectId();

			const mockFolloweeUser = { _id: followeeId };

			mockUsersCollection.findOne.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } }).resolves(null);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			const result = await repository.isFollowingByPublicId(followerPublicId, followeePublicId);

			expect(result).to.be.false;
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
		});

		it("should return false when followee user does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("nonexistent-followee");
			const followerId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } }).resolves(null);

			const result = await repository.isFollowingByPublicId(followerPublicId, followeePublicId);

			expect(result).to.be.false;
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
		});

		it("should return false when follow relationship does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			mockModel.findOne.resolves(null);

			const result = await repository.isFollowingByPublicId(followerPublicId, followeePublicId);

			expect(result).to.be.false;
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
		});

		it("should throw DatabaseError when database operation fails", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");

			const dbError = new Error("Database connection failed");
			mockUsersCollection.findOne.rejects(dbError);

			await expect(repository.isFollowingByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"Database connection failed",
			);
		});
	});

	describe("addFollow", () => {
		it("should create a new follow relationship successfully", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const mockFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			// Mock that no existing follow relationship exists
			mockModel.findOne.resolves(null);
			mockModel.create.resolves([mockFollow]);

			const result = await repository.addFollow(followerId, followeeId);

			expect(result).to.deep.equal(mockFollow);
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.create.calledOnceWith([{ followerId, followeeId }], { session: undefined })).to.be.true;
		});

		it("should create a new follow relationship with session", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const mockFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			// Mock that no existing follow relationship exists
			mockModel.findOne.resolves(null);
			mockModel.create.resolves([mockFollow]);

			const result = await sessionALS.run(mockSession, () =>
				repository.addFollow(followerId, followeeId),
			);

			expect(result).to.deep.equal(mockFollow);
			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.create.calledOnceWith([{ followerId, followeeId }], { session: mockSession })).to.be.true;
		});

		it("should throw DuplicateError when follow relationship already exists", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const existingFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			// Mock that follow relationship already exists
			mockModel.findOne.resolves(existingFollow);

			await expect(repository.addFollow(followerId, followeeId)).to.be.rejectedWith("Already following this user");

			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.create.called).to.be.false;
		});
	});

	describe("addFollowByPublicId", () => {
		it("should create a new follow relationship using publicIds", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const mockFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that no existing follow relationship exists
			mockModel.findOne.resolves(null);
			mockModel.create.resolves([mockFollow]);

			const result = await repository.addFollowByPublicId(followerPublicId, followeePublicId);

			expect(result).to.deep.equal(mockFollow);
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(mockModel.create.calledOnce).to.be.true;
		});

		it("should create a new follow relationship using publicIds with session", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const mockFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that no existing follow relationship exists
			mockModel.findOne.resolves(null);
			mockModel.create.resolves([mockFollow]);

			const result = await sessionALS.run(mockSession, () =>
				repository.addFollowByPublicId(followerPublicId, followeePublicId),
			);

			expect(result).to.deep.equal(mockFollow);
			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(
				mockModel.create.calledOnceWith([{ followerId: followerId.toString(), followeeId: followeeId.toString() }], {
					session: mockSession,
				}),
			).to.be.true;
		});

		it("should throw NotFoundError when follower user does not exist", async () => {
			const followerPublicId = asUserPublicId("nonexistent-follower");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followeeId = generateRandomObjectId();

			const mockFolloweeUser = { _id: followeeId };

			mockUsersCollection.findOne.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } }).resolves(null);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			await expect(repository.addFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"One or both users not found",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
			expect(mockModel.create.called).to.be.false;
		});

		it("should throw NotFoundError when followee user does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("nonexistent-followee");
			const followerId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } }).resolves(null);

			await expect(repository.addFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"One or both users not found",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
			expect(mockModel.create.called).to.be.false;
		});

		it("should throw DuplicateError when follow relationship already exists", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const existingFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that follow relationship already exists
			mockModel.findOne.resolves(existingFollow);

			await expect(repository.addFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"Already following this user",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(mockModel.create.called).to.be.false;
		});

		it("should preserve the DuplicateError type when follow relationship already exists", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves({ _id: followerId });
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves({ _id: followeeId });
			mockModel.findOne.resolves(generateMockFollow({ followerId, followeeId }));

			try {
				await repository.addFollowByPublicId(followerPublicId, followeePublicId);
				throw new Error("Expected addFollowByPublicId() to throw");
			} catch (error: any) {
				expect(error.name).to.equal("DuplicateError");
				expect(error.message).to.equal("Already following this user");
			}
		});

		it("should throw DatabaseError when database operation fails", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");

			const dbError = new Error("Database connection failed");
			mockUsersCollection.findOne.rejects(dbError);

			await expect(repository.addFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"Database connection failed",
			);
		});
	});

	describe("removeFollow", () => {
		it("should remove follow relationship successfully", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const existingFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			// Mock that follow relationship exists
			mockModel.findOne.resolves(existingFollow);
			mockModel.deleteOne.resolves({ deletedCount: 1 });

			await repository.removeFollow(followerId, followeeId);

			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.deleteOne.calledOnceWith({ followerId, followeeId }, { session: undefined })).to.be.true;
		});

		it("should remove follow relationship with session", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());
			const existingFollow = generateMockFollow({
				followerId: new Types.ObjectId(followerId),
				followeeId: new Types.ObjectId(followeeId),
			});

			// Mock that follow relationship exists
			mockModel.findOne.resolves(existingFollow);
			mockModel.deleteOne.resolves({ deletedCount: 1 });

			await sessionALS.run(mockSession, () => repository.removeFollow(followerId, followeeId));

			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.deleteOne.calledOnceWith({ followerId, followeeId }, { session: mockSession })).to.be.true;
		});

		it("should throw NotFoundError when follow relationship does not exist", async () => {
			const followerId = asMongoId(generateRandomObjectId().toString());
			const followeeId = asMongoId(generateRandomObjectId().toString());

			// Mock that follow relationship does not exist
			mockModel.findOne.resolves(null);

			await expect(repository.removeFollow(followerId, followeeId)).to.be.rejectedWith("Not following this user");

			expect(mockModel.findOne.calledOnceWith({ followerId, followeeId })).to.be.true;
			expect(mockModel.deleteOne.called).to.be.false;
		});
	});

	describe("removeFollowByPublicId", () => {
		it("should remove follow relationship using publicIds", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const existingFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that follow relationship exists
			mockModel.findOne.resolves(existingFollow);
			mockModel.deleteOne.resolves({ deletedCount: 1 });

			await repository.removeFollowByPublicId(followerPublicId, followeePublicId);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(
				mockModel.deleteOne.calledOnceWith(
					{ followerId: followerId.toString(), followeeId: followeeId.toString() },
					{ session: undefined },
				),
			).to.be.true;
		});

		it("should remove follow relationship using publicIds with session", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };
			const existingFollow = generateMockFollow({ followerId, followeeId });

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that follow relationship exists
			mockModel.findOne.resolves(existingFollow);
			mockModel.deleteOne.resolves({ deletedCount: 1 });

			await sessionALS.run(mockSession, () =>
				repository.removeFollowByPublicId(followerPublicId, followeePublicId),
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(
				mockModel.deleteOne.calledOnceWith(
					{ followerId: followerId.toString(), followeeId: followeeId.toString() },
					{ session: mockSession },
				),
			).to.be.true;
		});

		it("should throw NotFoundError when follower user does not exist", async () => {
			const followerPublicId = asUserPublicId("nonexistent-follower");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followeeId = generateRandomObjectId();

			const mockFolloweeUser = { _id: followeeId };

			mockUsersCollection.findOne.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } }).resolves(null);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			await expect(repository.removeFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"One or both users not found",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
			expect(mockModel.deleteOne.called).to.be.false;
		});

		it("should throw NotFoundError when followee user does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("nonexistent-followee");
			const followerId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } }).resolves(null);

			await expect(repository.removeFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"One or both users not found",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.called).to.be.false;
			expect(mockModel.deleteOne.called).to.be.false;
		});

		it("should throw NotFoundError when follow relationship does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			const mockFollowerUser = { _id: followerId };
			const mockFolloweeUser = { _id: followeeId };

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves(mockFollowerUser);
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves(mockFolloweeUser);

			// Mock that follow relationship does not exist
			mockModel.findOne.resolves(null);

			await expect(repository.removeFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"Not following this user",
			);

			expect(mockUsersCollection.findOne.calledTwice).to.be.true;
			expect(mockModel.findOne.calledOnceWith({ followerId: followerId.toString(), followeeId: followeeId.toString() }))
				.to.be.true;
			expect(mockModel.deleteOne.called).to.be.false;
		});

		it("should preserve the NotFoundError type when follow relationship does not exist", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");
			const followerId = generateRandomObjectId();
			const followeeId = generateRandomObjectId();

			mockUsersCollection.findOne
				.withArgs({ publicId: followerPublicId }, { projection: { _id: 1 } })
				.resolves({ _id: followerId });
			mockUsersCollection.findOne
				.withArgs({ publicId: followeePublicId }, { projection: { _id: 1 } })
				.resolves({ _id: followeeId });
			mockModel.findOne.resolves(null);

			try {
				await repository.removeFollowByPublicId(followerPublicId, followeePublicId);
				throw new Error("Expected removeFollowByPublicId() to throw");
			} catch (error: any) {
				expect(error.name).to.equal("NotFoundError");
				expect(error.message).to.equal("Not following this user");
			}
		});

		it("should throw DatabaseError when database operation fails", async () => {
			const followerPublicId = asUserPublicId("follower-public-123");
			const followeePublicId = asUserPublicId("followee-public-456");

			const dbError = new Error("Database connection failed");
			mockUsersCollection.findOne.rejects(dbError);

			await expect(repository.removeFollowByPublicId(followerPublicId, followeePublicId)).to.be.rejectedWith(
				"Database connection failed",
			);
		});
	});
});
