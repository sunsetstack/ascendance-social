import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";
import { ClientSession, Model, Types } from "mongoose";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { IFavorite, IPost } from "@/types";
import { asPostPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

interface MockFavoriteDoc extends IFavorite {
	save: SinonStub;
	$session: SinonStub;
	_id: Types.ObjectId;
}

const createMockFavoriteDocInstance = (favoriteData: Partial<IFavorite>): MockFavoriteDoc => {
	const instance = {
		...favoriteData,
		_id: favoriteData._id || new Types.ObjectId(),
		save: sinon.stub(),
		$session: sinon.stub().returnsThis(),
	} as unknown as MockFavoriteDoc;
	instance.save!.resolves(instance);
	return instance;
};

interface MockFavoriteModelFunc extends SinonStub {
	findOne: SinonStub;
	deleteOne: SinonStub;
	countDocuments: SinonStub;
	aggregate: SinonStub;
}

describe("FavoriteRepository", () => {
	let repository: FavoriteRepository;
	let mockModel: MockFavoriteModelFunc;
	let mockSession: ClientSession;
	let mockQuery: {
		session: SinonStub;
		exec: SinonStub;
	};
	let mockAggregateQuery: {
		exec: SinonStub;
	};

	beforeEach(() => {
		mockQuery = {
			session: sinon.stub().returnsThis(),
			exec: sinon.stub(),
		};

		mockAggregateQuery = {
			exec: sinon.stub(),
		};

		mockModel = sinon.stub() as MockFavoriteModelFunc;
		mockModel.findOne = sinon.stub().returns(mockQuery);
		mockModel.deleteOne = sinon.stub().returns(mockQuery);
		mockModel.countDocuments = sinon.stub().resolves(0);
		mockModel.aggregate = sinon.stub().returns(mockAggregateQuery);

		mockModel.callsFake((data) => createMockFavoriteDocInstance(data));

		mockSession = {} as ClientSession;
		repository = new FavoriteRepository(mockModel as any as Model<IFavorite>);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("findByUserAndPost", () => {
		const userId = new Types.ObjectId().toString();
		const postId = new Types.ObjectId().toString();

		it("should find existing favorite by user and post", async () => {
			const mockFavorite = {
				_id: new Types.ObjectId(),
				userId: new Types.ObjectId(userId),
				postId: new Types.ObjectId(postId),
				createdAt: new Date(),
				updatedAt: new Date(),
			} as IFavorite;

			mockQuery.exec.resolves(mockFavorite);

			const result = await repository.findByUserAndPost(userId, postId);

			expect(mockModel.findOne.calledWith({ userId, postId })).to.be.true;
			expect(mockQuery.session.calledWith(null)).to.be.true;
			expect(result).to.deep.equal(mockFavorite);
		});

		it("should return null when favorite not found", async () => {
			mockQuery.exec.resolves(null);

			const result = await repository.findByUserAndPost(userId, postId);

			expect(result).to.be.null;
		});

	});

	describe("remove", () => {
		const userId = new Types.ObjectId().toString();
		const postId = new Types.ObjectId().toString();

		it("should remove favorite and return true when successful", async () => {
			mockQuery.exec.resolves({ deletedCount: 1 });

			const result = await repository.remove(userId, postId);

			expect(mockModel.deleteOne.calledWith({ userId, postId })).to.be.true;
			expect(mockQuery.session.calledWith(null)).to.be.true;
			expect(result).to.be.true;
		});

		it("should return false when no favorite was deleted", async () => {
			mockQuery.exec.resolves({ deletedCount: 0 });

			const result = await repository.remove(userId, postId);

			expect(result).to.be.false;
		});

	});

	describe("findFavoritesByUserId", () => {
		const userId = new Types.ObjectId().toString();
		const mockPosts: Partial<IPost>[] = [
			{
				_id: new Types.ObjectId(),
				publicId: asPostPublicId("post-1"),
				body: "Test post 1",
				slug: "test-post-1",
				user: {
					publicId: "user-1",
					username: "testuser1",
					avatar: "avatar1.jpg",
				} as any,
				tags: [],
				createdAt: new Date(),
			},
			{
				_id: new Types.ObjectId(),
				publicId: asPostPublicId("post-2"),
				body: "Test post 2",
				slug: "test-post-2",
				user: {
					publicId: "user-2",
					username: "testuser2",
					avatar: "avatar2.jpg",
				} as any,
				tags: [],
				createdAt: new Date(),
			},
		];

		it("should return paginated favorites with default pagination", async () => {
			const totalCount = 5;
			mockModel.countDocuments.resolves(totalCount);
			mockAggregateQuery.exec.resolves(mockPosts);

			const result = await repository.findFavoritesByUserId(userId);

			expect(mockModel.countDocuments.calledWith({ userId })).to.be.true;
			expect(mockModel.aggregate.called).to.be.true;
			expect(result.data).to.deep.equal(mockPosts);
			expect(result.total).to.equal(totalCount);
		});

		it("should return paginated favorites with custom pagination", async () => {
			const page = 2;
			const limit = 10;
			const totalCount = 25;
			mockModel.countDocuments.resolves(totalCount);
			mockAggregateQuery.exec.resolves(mockPosts.slice(0, 1));

			const result = await repository.findFavoritesByUserId(userId, page, limit);

			expect(mockModel.aggregate.called).to.be.true;
			expect(result.total).to.equal(totalCount);
		});

		it("should handle empty results", async () => {
			mockModel.countDocuments.resolves(0);
			mockAggregateQuery.exec.resolves([]);

			const result = await repository.findFavoritesByUserId(userId);

			expect(result.data).to.deep.equal([]);
			expect(result.total).to.equal(0);
		});
	});
});
