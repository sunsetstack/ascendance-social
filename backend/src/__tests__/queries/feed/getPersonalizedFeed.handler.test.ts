import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon, { SinonStub } from "sinon";

import { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

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
				CacheKeyBuilder.getPersonalizedCursorFeedKey("viewer", undefined, 10),
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

	it("wraps errors as InternalServerError and preserves the cause", async () => {
		const cause = new Error("boom");
		mockRedisService.getWithTags.rejects(cause);

		const error = await handler
			.execute(new GetPersonalizedFeedQuery("viewer", 1, 10))
			.catch((caught: unknown) => caught);

		expect(error).to.be.instanceOf(Error);
		expect((error as Error).name).to.equal("InternalServerError");
		expect((error as Error).message).to.equal(
			"Could not generate personalized feed for user viewer: boom",
		);
		expect((error as Error & { cause?: unknown }).cause).to.equal(cause);
	});
});
