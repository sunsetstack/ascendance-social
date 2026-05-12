import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";

import { GetTrendingFeedQueryHandler } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.handler";
import { GetTrendingFeedQuery } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.query";

chai.use(chaiAsPromised);

describe("GetTrendingFeedQueryHandler", () => {
	let handler: GetTrendingFeedQueryHandler;

	let mockFeedReadDao: { getTrendingFeedWithCursor: SinonStub };
	let mockPostReadRepository: {
		findPostsByPublicIds: SinonStub;
		getTrendingFeedWithCursor: SinonStub;
	};
	let mockUserReadRepository: { findByPublicId: SinonStub };
	let mockRedisService: { getTrendingFeedWithCursor: SinonStub };
	let mockDTOService: unknown;
	let mockFeedEnrichmentService: { enrichFeedWithCurrentData: SinonStub };

	beforeEach(() => {
		mockFeedReadDao = { getTrendingFeedWithCursor: sinon.stub() };
		mockPostReadRepository = {
			findPostsByPublicIds: sinon.stub(),
			getTrendingFeedWithCursor: sinon.stub(),
		};
		mockUserReadRepository = { findByPublicId: sinon.stub() };
		mockRedisService = {
			getTrendingFeedWithCursor: sinon.stub(),
		};
		mockDTOService = {};
		mockFeedEnrichmentService = { enrichFeedWithCurrentData: sinon.stub() };

		handler = new GetTrendingFeedQueryHandler(
			mockFeedReadDao as any,
			mockPostReadRepository as any,
			mockUserReadRepository as any,
			mockRedisService as any,
			mockDTOService as any,
			mockFeedEnrichmentService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("uses Redis ZSET when it has post IDs", async () => {
		mockRedisService.getTrendingFeedWithCursor.resolves({ ids: ["p1", "p2"], hasMore: false, nextCursor: "n1" });
		mockPostReadRepository.findPostsByPublicIds.resolves([
			{
				publicId: "p1",
				body: "b1",
				slug: "s1",
				createdAt: new Date(),
				likesCount: 1,
				commentsCount: 0,
				viewsCount: 0,
				author: { publicId: "u1", handle: "h", username: "n", avatar: "" },
				tags: [],
			},
			{
				publicId: "p2",
				body: "b2",
				slug: "s2",
				createdAt: new Date(),
				likesCount: 2,
				commentsCount: 0,
				viewsCount: 0,
				author: { publicId: "u2", handle: "h", username: "n", avatar: "" },
				tags: [],
			},
		]);
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetTrendingFeedQuery(1, 2));

		expect(mockPostReadRepository.findPostsByPublicIds.calledWith(["p1", "p2"])).to.be.true;
		expect(mockFeedReadDao.getTrendingFeedWithCursor.called).to.be.false;
		expect(result.total).to.equal(0);
		expect(result.data).to.have.lengthOf(2);
	});

	it("falls back to Mongo when Redis ZSET is empty", async () => {
		mockRedisService.getTrendingFeedWithCursor.resolves({ ids: [], hasMore: false, nextCursor: undefined });
		mockFeedReadDao.getTrendingFeedWithCursor.resolves({
			data: [
				{
					publicId: "p3",
					body: "b3",
					slug: "s3",
					createdAt: new Date(),
					likesCount: 0,
					commentsCount: 0,
					viewsCount: 0,
					author: { publicId: "u3", handle: "h", username: "n", avatar: "" },
					tags: [],
				},
			],
			hasMore: false,
			nextCursor: undefined,
		});
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetTrendingFeedQuery(1, 10));

		expect(mockFeedReadDao.getTrendingFeedWithCursor.calledOnce).to.be.true;
		expect(mockPostReadRepository.findPostsByPublicIds.called).to.be.false;
		expect(result.total).to.equal(0);
		expect(result.data).to.have.lengthOf(1);
	});

	it("wraps errors as FeedError", async () => {
		mockRedisService.getTrendingFeedWithCursor.rejects(new Error("redis down"));
		mockFeedReadDao.getTrendingFeedWithCursor.rejects(new Error("db down"));

		await expect(handler.execute(new GetTrendingFeedQuery(1, 10))).to.be.rejectedWith(
			"Could not generate trending feed.",
		);
	});
});
