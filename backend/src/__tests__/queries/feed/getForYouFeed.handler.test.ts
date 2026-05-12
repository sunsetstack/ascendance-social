import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";

import { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";

chai.use(chaiAsPromised);

describe("GetForYouFeedQueryHandler", () => {
	let handler: GetForYouFeedQueryHandler;

	let mockFeedReadDao: { getRankedFeedWithCursor: SinonStub, getRankedFeed: SinonStub };
	let mockPostReadRepository: {
		findPostsByPublicIds: SinonStub;
		getRankedFeedWithCursor: SinonStub;
	};
	let mockUserReadRepository: { findByPublicId: SinonStub };
	let mockUserPreferenceRepository: { getTopUserTags: SinonStub };
	let mockRedisService: { getFeedWithCursor: SinonStub; addToFeed: SinonStub };
	let mockEventBus: { publish: SinonStub };
	let mockFeedEnrichmentService: { enrichFeedWithCurrentData: SinonStub };

	beforeEach(() => {
		mockFeedReadDao = { getRankedFeedWithCursor: sinon.stub(), getRankedFeed: sinon.stub() };
		mockPostReadRepository = {
			findPostsByPublicIds: sinon.stub(),
			getRankedFeedWithCursor: sinon.stub(),
		};
		mockUserReadRepository = { findByPublicId: sinon.stub() };
		mockUserPreferenceRepository = { getTopUserTags: sinon.stub() };
		mockRedisService = {
			getFeedWithCursor: sinon.stub(),
			addToFeed: sinon.stub().resolves(),
		};
		mockEventBus = { publish: sinon.stub() };
		mockFeedEnrichmentService = { enrichFeedWithCurrentData: sinon.stub() };

		handler = new GetForYouFeedQueryHandler(
			mockFeedReadDao as any,
			mockPostReadRepository as any,
			mockUserReadRepository as any,
			mockUserPreferenceRepository as any,
			mockRedisService as any,
			mockEventBus as any,
			mockFeedEnrichmentService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("returns from Redis feed when ZSET hit", async () => {
		mockRedisService.getFeedWithCursor.resolves({ ids: ["p1"], hasMore: false, nextCursor: undefined });
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
		]);
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetForYouFeedQuery("viewer", 1, 10));

		expect(mockFeedReadDao.getRankedFeedWithCursor.called).to.be.false;
		expect(result.data[0].publicId).to.equal("p1");
		expect(result.total).to.equal(0);
	});

	it("generates from DB and populates ZSET on first-page miss", async () => {
		mockRedisService.getFeedWithCursor.resolves({ ids: [], hasMore: false, nextCursor: undefined });
		mockUserReadRepository.findByPublicId.resolves({ _id: "userObjectId" });
		mockUserPreferenceRepository.getTopUserTags.resolves([{ tag: "cats" }]);
		mockFeedReadDao.getRankedFeedWithCursor.resolves({
			data: [
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
			],
			hasMore: false,
			nextCursor: undefined,
		});
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetForYouFeedQuery("viewer", 1, 10));

		expect(mockFeedReadDao.getRankedFeedWithCursor.calledOnce).to.be.true;
		expect(mockRedisService.addToFeed.called).to.be.true;
		expect(result.data[0].publicId).to.equal("p1");
	});

	it("does not populate ZSET when cursor pagination is used", async () => {
		mockRedisService.getFeedWithCursor.resolves({ ids: [], hasMore: false, nextCursor: undefined });
		mockUserReadRepository.findByPublicId.resolves({ _id: "userObjectId" });
		mockUserPreferenceRepository.getTopUserTags.resolves([]);
		mockFeedReadDao.getRankedFeedWithCursor.resolves({ data: [], hasMore: false, nextCursor: undefined });
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		await handler.execute(new GetForYouFeedQuery("viewer", 2, 10, "cursor-token"));
		expect(mockRedisService.addToFeed.called).to.be.false;
	});

	it("wraps errors as FeedError", async () => {
		mockRedisService.getFeedWithCursor.resolves({ ids: [], hasMore: false, nextCursor: undefined });
		mockUserReadRepository.findByPublicId.resolves(null);

		await expect(handler.execute(new GetForYouFeedQuery("viewer", 1, 10))).to.be.rejectedWith(
			"Could not generate For You feed.",
		);
	});
});
