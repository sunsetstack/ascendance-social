import { describe, beforeEach, afterEach, it } from "mocha";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, { SinonStub } from "sinon";

import { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

chai.use(chaiAsPromised);

describe("GetPersonalizedFeedQueryHandler", () => {
	let handler: GetPersonalizedFeedQueryHandler;

	let mockRedisService: { getWithTags: SinonStub; setWithTags: SinonStub };
	let mockFeedEnrichmentService: { enrichFeedWithCurrentData: SinonStub };
	let mockFeedCoreService: { generatePersonalizedCoreFeed: SinonStub };

	beforeEach(() => {
		mockRedisService = {
			getWithTags: sinon.stub(),
			setWithTags: sinon.stub().resolves(),
		};
		mockFeedEnrichmentService = { enrichFeedWithCurrentData: sinon.stub() };
		mockFeedCoreService = { generatePersonalizedCoreFeed: sinon.stub() };

		handler = new GetPersonalizedFeedQueryHandler(
			mockRedisService as any,
			mockFeedEnrichmentService as any,
			mockFeedCoreService as any,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	it("returns cached core feed when Redis hit", async () => {
		mockRedisService.getWithTags.resolves({ data: [{ publicId: "p1" }], total: 1, page: 1, limit: 10, totalPages: 1 });
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetPersonalizedFeedQuery("viewer", 1, 10));

		expect(mockFeedCoreService.generatePersonalizedCoreFeed.called).to.be.false;
		expect(mockRedisService.setWithTags.called).to.be.false;
		expect(result.data[0].publicId).to.equal("p1");
	});

	it("generates and caches core feed on miss", async () => {
		mockRedisService.getWithTags.resolves(null);
		mockFeedCoreService.generatePersonalizedCoreFeed.resolves({
			data: [{ publicId: "p2" }],
			total: 1,
			page: 1,
			limit: 10,
			totalPages: 1,
		});
		mockFeedEnrichmentService.enrichFeedWithCurrentData.callsFake(async (posts: any) => posts);

		const result = await handler.execute(new GetPersonalizedFeedQuery("viewer", 1, 10));

		expect(mockFeedCoreService.generatePersonalizedCoreFeed.calledOnceWith("viewer", 10, undefined)).to.be.true;
		expect(
			mockRedisService.setWithTags.calledOnceWith(
				`${CacheKeyBuilder.PREFIXES.CORE_FEED}:cursor:viewer:first_page:10`,
				sinon.match.object,
				[
					CacheKeyBuilder.getUserFeedTag("viewer"),
					CacheKeyBuilder.getFeedLimitTag(10),
				],
				300,
			),
		).to.be.true;
		expect(result.data[0].publicId).to.equal("p2");
	});

	it("wraps errors as UnknownError", async () => {
		mockRedisService.getWithTags.rejects(new Error("boom"));

		await expect(handler.execute(new GetPersonalizedFeedQuery("viewer", 1, 10))).to.be.rejectedWith(
			"Could not generate personalized feed for user viewer: boom",
		);
	});
});
