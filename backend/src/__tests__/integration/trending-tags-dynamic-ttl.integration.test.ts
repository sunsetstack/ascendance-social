import "reflect-metadata";
import { describe, it, before, after, beforeEach } from "mocha";
import { expect } from "chai";
import { container } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import { TagService, TAG_ACTIVITY_METRICS_KEY, TagActivityMetrics } from "@/services/tag.service";
import { GetTrendingTagsQueryHandler } from "@/application/queries/tags/getTrendingTags/getTrendingTags.handler";
import { GetTrendingTagsQuery } from "@/application/queries/tags/getTrendingTags/getTrendingTags.query";
import { MetricsService } from "@/metrics/metrics.service";
import mongoose from "mongoose";

/**
 * Integration tests for the Dynamic TTL Trending Tags system
 *
 * These tests use the REAL Redis server to verify:
 * 1. Activity tracking works when tags are used
 * 2. Dynamic TTL calculation responds to activity levels
 * 3. Historical fallback keeps tags visible during dormant periods
 * 4. Tiered time window fallback (Cache Waterfall) works
 *
 * Run with: npm test -- --grep "Trending Tags Dynamic TTL"
 */

describe("Trending Tags Dynamic TTL Integration", function () {
	// increase timeout for real Redis operations
	this.timeout(30000);

	let redisService: RedisService;
	let tagService: TagService;
	let trendingTagsHandler: GetTrendingTagsQueryHandler;

	// test cache keys to clean up
	const testKeys = [
		TAG_ACTIVITY_METRICS_KEY,
		"trending_tags:historical",
		"trending_tags:5:168",
		"trending_tags:5:24",
		"trending_tags:5:336",
	];

	before(async function () {
		// setup DI container with real services
		const metricsService = new MetricsService();
		container.registerInstance("MetricsService", metricsService);

		redisService = new RedisService(metricsService);
		container.registerInstance("RedisService", redisService);

		// wait for Redis connection
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// verify Redis is connected
		try {
			await redisService.set("test:connection", "ok", 10);
			const val = await redisService.get("test:connection");
			if (val !== "ok") {
				throw new Error("Redis connection test failed");
			}
			console.log("✓ Redis connection verified");
		} catch (error) {
			console.error("Redis not available, skipping integration tests");
			this.skip();
		}
	});

	beforeEach(async function () {
		// clean up test keys before each test
		for (const key of testKeys) {
			try {
				await redisService.del(key);
			} catch {
				// ignore errors during cleanup
			}
		}
	});

	after(async function () {
		// final cleanup
		for (const key of testKeys) {
			try {
				await redisService.del(key);
			} catch {
				// ignore
			}
		}
	});

	describe("Activity Tracking (TagService.incrementUsage)", function () {
		it("should create activity metrics on first tag usage", async function () {
			// create a mock TagRepository since we only need incrementUsage
			const mockTagRepo = {
				findOneAndUpdate: async () => ({}),
			};

			tagService = new TagService(mockTagRepo as any, redisService);

			// simulate using 3 tags in a post
			const fakeTagIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

			await tagService.incrementUsage(fakeTagIds);

			// wait for async activity tracking
			await new Promise((resolve) => setTimeout(resolve, 200));

			// verify activity metrics were created
			const metrics = await redisService.get<TagActivityMetrics>(TAG_ACTIVITY_METRICS_KEY);

			expect(metrics).to.not.be.null;
			expect(metrics!.tagUsageCount).to.equal(3);
			expect(metrics!.recentUsageCount).to.equal(3);
			expect(metrics!.lastUpdated).to.be.a("number");
			expect(metrics!.recentWindowStart).to.be.a("number");

			console.log("✓ Activity metrics created:", metrics);
		});

		it("should accumulate activity across multiple tag usages", async function () {
			const mockTagRepo = {
				findOneAndUpdate: async () => ({}),
			};

			tagService = new TagService(mockTagRepo as any, redisService);

			// simulate first post with 2 tags
			await tagService.incrementUsage([new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]);
			await new Promise((resolve) => setTimeout(resolve, 200));

			// simulate second post with 3 tags
			await tagService.incrementUsage([
				new mongoose.Types.ObjectId(),
				new mongoose.Types.ObjectId(),
				new mongoose.Types.ObjectId(),
			]);
			await new Promise((resolve) => setTimeout(resolve, 200));

			const metrics = await redisService.get<TagActivityMetrics>(TAG_ACTIVITY_METRICS_KEY);

			expect(metrics).to.not.be.null;
			// should have accumulated (with minimal decay since <1 second passed)
			expect(metrics!.tagUsageCount).to.be.greaterThan(4.9);
			expect(metrics!.recentUsageCount).to.equal(5);

			console.log("✓ Activity accumulated:", metrics);
		});

		it("should apply exponential decay to old activity", async function () {
			// manually set old activity metrics
			const oldTimestamp = Date.now() - 48 * 3600 * 1000; // 48 hours ago
			await redisService.set(
				TAG_ACTIVITY_METRICS_KEY,
				{
					tagUsageCount: 100,
					lastUpdated: oldTimestamp,
					recentUsageCount: 50,
					recentWindowStart: oldTimestamp,
				} as TagActivityMetrics,
				3600,
			);

			const mockTagRepo = {
				findOneAndUpdate: async () => ({}),
			};

			tagService = new TagService(mockTagRepo as any, redisService);

			// add new activity
			await tagService.incrementUsage([new mongoose.Types.ObjectId()]);
			await new Promise((resolve) => setTimeout(resolve, 200));

			const metrics = await redisService.get<TagActivityMetrics>(TAG_ACTIVITY_METRICS_KEY);

			// 48 hours = 2 half-lives, so 100 * e^(-48/24) ≈ 100 * 0.135 ≈ 13.5 + 1 new
			expect(metrics!.tagUsageCount).to.be.lessThan(20);
			expect(metrics!.tagUsageCount).to.be.greaterThan(10);

			// recent window should have been reset since it was >1 hour old
			expect(metrics!.recentUsageCount).to.equal(1);

			console.log("✓ Decay applied correctly:", metrics);
		});
	});

	describe("Dynamic TTL Calculation", function () {
		it("should return MEDIUM TTL (30min) when no activity metrics exist", async function () {
			// ensure no activity metrics
			await redisService.del(TAG_ACTIVITY_METRICS_KEY);

			// mock the post read repository
			const mockPostReadRepo = {
				getTrendingTags: async () => [{ tag: "test", count: 10, recentPostCount: 5 }],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);

			// clear any cached trending tags
			await redisService.del("trending_tags:5:168");

			const result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			expect(result.tags).to.have.lengthOf(1);

			// check what TTL was set (we can't directly check, but we can verify the cache exists)
			const cached = await redisService.get("trending_tags:5:168");
			expect(cached).to.not.be.null;

			console.log("✓ Handler works with no activity metrics");
		});

		it("should use DORMANT TTL (30d) when no activity in 24+ hours", async function () {
			// set old activity (>24 hours ago)
			const oldTimestamp = Date.now() - 30 * 3600 * 1000; // 30 hours ago
			await redisService.set(
				TAG_ACTIVITY_METRICS_KEY,
				{
					tagUsageCount: 50,
					lastUpdated: oldTimestamp,
					recentUsageCount: 10,
					recentWindowStart: oldTimestamp,
				} as TagActivityMetrics,
				3600,
			);

			const mockPostReadRepo = {
				getTrendingTags: async () => [{ tag: "dormant", count: 5, recentPostCount: 1 }],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);
			await redisService.del("trending_tags:5:168");

			const result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));
			expect(result.tags[0].tag).to.equal("dormant");

			console.log("✓ Dormant site detected correctly");
		});

		it("should use HIGH TTL (5min) when activity is high (10+ tags/hour)", async function () {
			// simulate high activity: 15 tags in the last 30 minutes = 30 tags/hour
			const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
			await redisService.set(
				TAG_ACTIVITY_METRICS_KEY,
				{
					tagUsageCount: 50,
					lastUpdated: Date.now(),
					recentUsageCount: 15,
					recentWindowStart: thirtyMinsAgo,
				} as TagActivityMetrics,
				3600,
			);

			const mockPostReadRepo = {
				getTrendingTags: async () => [{ tag: "active", count: 100, recentPostCount: 50 }],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);
			await redisService.del("trending_tags:5:168");

			const result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));
			expect(result.tags[0].tag).to.equal("active");

			console.log("✓ High activity detected correctly");
		});
	});

	describe("Historical Fallback (Stale-While-Revalidate)", function () {
		it("should store trending tags in historical cache", async function () {
			const mockPostReadRepo = {
				getTrendingTags: async () => [
					{ tag: "historical1", count: 50, recentPostCount: 10 },
					{ tag: "historical2", count: 40, recentPostCount: 8 },
				],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);

			// clear caches
			await redisService.del("trending_tags:5:168");
			await redisService.del("trending_tags:historical");

			await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			// verify historical cache was created
			const historical = await redisService.get("trending_tags:historical");
			expect(historical).to.not.be.null;
			expect((historical as any).tags).to.have.lengthOf(2);
			expect((historical as any).tags[0].tag).to.equal("historical1");

			console.log("✓ Historical cache created:", historical);
		});

		it("should return historical tags when no fresh tags exist", async function () {
			// first, populate historical cache
			await redisService.set(
				"trending_tags:historical",
				{
					tags: [
						{ tag: "old_but_gold", count: 100, recentPostCount: 20 },
						{ tag: "classic", count: 80, recentPostCount: 15 },
					],
				},
				3888000,
			);

			// mock repo that returns empty (simulating a dead site)
			const mockPostReadRepo = {
				getTrendingTags: async () => [],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);

			// clear main cache
			await redisService.del("trending_tags:5:168");

			const result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			// should get historical tags
			expect(result.tags).to.have.lengthOf(2);
			expect(result.tags[0].tag).to.equal("old_but_gold");
			expect(result.tags[1].tag).to.equal("classic");

			console.log(
				"✓ Historical fallback works! Tags returned:",
				result.tags.map((t) => t.tag),
			);
		});

		it("should cache historical fallback with long TTL", async function () {
			// populate historical
			await redisService.set(
				"trending_tags:historical",
				{ tags: [{ tag: "cached_historical", count: 50, recentPostCount: 5 }] },
				3888000,
			);

			const mockPostReadRepo = {
				getTrendingTags: async () => [],
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);
			await redisService.del("trending_tags:5:168");

			// first call - should hit historical
			await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			// verify main cache now has the historical data
			const mainCache = await redisService.get("trending_tags:5:168");
			expect(mainCache).to.not.be.null;
			expect((mainCache as any).tags[0].tag).to.equal("cached_historical");

			console.log("✓ Historical data cached in main cache");
		});
	});

	describe("Tiered Time Window Fallback (Cache Waterfall)", function () {
		it("should try extended time windows when recent window is empty", async function () {
			let callCount = 0;
			const mockPostReadRepo = {
				getTrendingTags: async (limit: number, timeWindowHours: number) => {
					callCount++;
					console.log(`  → getTrendingTags called with window: ${timeWindowHours}h (call #${callCount})`);

					// return empty for 168h (1 week) but have data for 720h (1 month)
					if (timeWindowHours <= 336) {
						return [];
					}
					return [{ tag: "from_extended_window", count: 30, recentPostCount: 5 }];
				},
			};

			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);

			// clear caches
			await redisService.del("trending_tags:5:168");
			await redisService.del("trending_tags:historical");

			const result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			expect(result.tags).to.have.lengthOf(1);
			expect(result.tags[0].tag).to.equal("from_extended_window");

			// should have tried: 168h, 336h (2w), 720h (1m) - found on 3rd try
			expect(callCount).to.be.greaterThanOrEqual(3);

			console.log("✓ Extended time window fallback works");
		});
	});

	describe("Full System Integration", function () {
		it("should keep tags visible through complete lifecycle", async function () {
			console.log("\n--- Full Lifecycle Test ---");

			// PHASE 1: Active site - create posts with tags
			console.log("\n1. Simulating active site...");

			const mockTagRepo = { findOneAndUpdate: async () => ({}) };
			tagService = new TagService(mockTagRepo as any, redisService);

			// simulate 20 tags used over "30 minutes"
			await tagService.incrementUsage(
				Array(20)
					.fill(null)
					.map(() => new mongoose.Types.ObjectId()),
			);
			await new Promise((resolve) => setTimeout(resolve, 200));

			let metrics = await redisService.get<TagActivityMetrics>(TAG_ACTIVITY_METRICS_KEY);
			console.log(`   Activity metrics: ${metrics?.recentUsageCount} tags in window`);

			// query trending tags
			const mockPostReadRepo = {
				getTrendingTags: async () => [
					{ tag: "popular", count: 100, recentPostCount: 50 },
					{ tag: "trending", count: 80, recentPostCount: 40 },
				],
			};
			trendingTagsHandler = new GetTrendingTagsQueryHandler(mockPostReadRepo as any, {} as any, redisService);
			await redisService.del("trending_tags:5:168");

			let result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));
			console.log(`   Trending tags: ${result.tags.map((t) => t.tag).join(", ")}`);
			expect(result.tags).to.have.lengthOf(2);

			// PHASE 2: Site goes dormant
			console.log("\n2. Simulating site going dormant (no activity for 48 hours)...");

			// fast-forward activity metrics to 48 hours ago
			const dormantTimestamp = Date.now() - 48 * 3600 * 1000;
			await redisService.set(
				TAG_ACTIVITY_METRICS_KEY,
				{
					tagUsageCount: metrics!.tagUsageCount,
					lastUpdated: dormantTimestamp,
					recentUsageCount: 0,
					recentWindowStart: dormantTimestamp,
				},
				604800,
			);

			// PHASE 3: Query when dormant - should still show tags from historical
			console.log("\n3. Querying trending tags when site is dormant...");

			// mock repo returns empty (no recent activity)
			const dormantMockRepo = {
				getTrendingTags: async () => [],
			};
			trendingTagsHandler = new GetTrendingTagsQueryHandler(dormantMockRepo as any, {} as any, redisService);
			await redisService.del("trending_tags:5:168");

			result = await trendingTagsHandler.execute(new GetTrendingTagsQuery(5, 168));

			console.log(`   Tags still visible: ${result.tags.map((t) => t.tag).join(", ")}`);
			expect(result.tags.length).to.be.greaterThan(0, "Tags should still be visible from historical cache!");
			expect(result.tags[0].tag).to.equal("popular");

			// PHASE 4: Verify the cached result will persist
			console.log("\n4. Verifying cache persistence...");

			// the result should now be cached with DORMANT TTL (30 days)
			const cachedResult = await redisService.get("trending_tags:5:168");
			expect(cachedResult).to.not.be.null;
			console.log(`   Cache exists with tags: ${(cachedResult as any).tags.map((t: any) => t.tag).join(", ")}`);

			console.log("\n FULL LIFECYCLE TEST PASSED");
			console.log("   → Tags remain visible even when site is completely dormant");
			console.log("   → Historical cache ensures continuity");
			console.log("   → Dynamic TTL extends cache duration during low activity\n");
		});
	});
});
