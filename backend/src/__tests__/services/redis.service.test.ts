import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { RedisService } from "@/services/redis.service";
import { MetricsService } from "@/metrics/metrics.service";

describe("RedisService", () => {
	let redisService: RedisService;
	let metricsServiceStub: sinon.SinonStubbedInstance<MetricsService>;
	let mockClient: any;
	let clientListeners: Record<string, (...args: any[]) => void>;

	beforeEach(() => {
		metricsServiceStub = sinon.createStubInstance(MetricsService);
		clientListeners = {};

		// Mock the client before instantiating RedisService so the constructor doesn't open real sockets
		mockClient = {
			isOpen: false,
			on: sinon.stub().returnsThis(),
			once: sinon.stub().callsFake((event: string, handler: (...args: any[]) => void) => {
				clientListeners[event] = handler;
				return mockClient;
			}),
			off: sinon.stub().callsFake((event: string, handler: (...args: any[]) => void) => {
				if (clientListeners[event] === handler) {
					delete clientListeners[event];
				}
				return mockClient;
			}),
			connect: sinon.stub().resolves(),
			quit: sinon.stub().resolves(),
			duplicate: sinon.stub(),
			get: sinon.stub(),
			mGet: sinon.stub(),
			set: sinon.stub(),
			setEx: sinon.stub(),
			del: sinon.stub(),
			type: sinon.stub().resolves("none"),
			multi: sinon.stub(),
		};

		redisService = new RedisService(metricsServiceStub as unknown as MetricsService);
		(redisService as any).client = mockClient;
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("withResilience", () => {
		it("should execute operation successfully", async () => {
			const operation = sinon.stub().resolves("success");

			// Access private method via any cast
			const result = await (redisService as any).withResilience(operation);

			expect(result).to.equal("success");
			expect(operation.calledOnce).to.be.true;
		});

		it("should retry on retryable error", async () => {
			const operation = sinon.stub();
			const error = new Error("Connection lost");
			(error as any).code = "ECONNRESET"; // Retryable code

			operation.onCall(0).rejects(error);
			operation.onCall(1).resolves("success");

			const result = await (redisService as any).withResilience(operation, {
				maxAttempts: 3,
				baseDelayMs: 1,
			});

			expect(result).to.equal("success");
			expect(operation.calledTwice).to.be.true;
		});

		it("should return fallback value on failure if provided", async () => {
			const operation = sinon.stub().rejects(new Error("Fatal"));

			const result = await (redisService as any).withResilience(operation, {
				maxAttempts: 1,
				fallbackValue: "fallback",
			});

			expect(result).to.equal("fallback");
		});

		it("should run at least once when maxAttempts is zero", async () => {
			const error = new Error("Fatal");
			const operation = sinon.stub().rejects(error);

			try {
				await (redisService as any).withResilience(operation, {
					maxAttempts: 0,
				});
				throw new Error("expected withResilience to throw");
			} catch (actual) {
				expect(actual).to.equal(error);
			}

			expect(operation.calledOnce).to.be.true;
		});
	});

	describe("get", () => {
		it("should return null for malformed cached JSON", async () => {
			mockClient.get.resolves("hello");

			const result = await redisService.get("key");

			expect(result).to.equal(null);
		});
	});

	describe("getValidated", () => {
		it("should validate string cache values without parsing twice", async () => {
			mockClient.get.resolves(JSON.stringify("hello"));

			const result = await redisService.getValidated(
				"key",
				(value): value is string => typeof value === "string",
			);

			expect(result).to.equal("hello");
		});
	});

	describe("waitForConnection", () => {
		it("should tolerate retryable errors until timeout expires", async () => {
			const clock = sinon.useFakeTimers();
			const pending = redisService.waitForConnection(1000);
			let resolved = false;
			pending.then(() => {
				resolved = true;
			});

			clientListeners.error(new Error("ECONNRESET connection lost"));
			await clock.tickAsync(999);
			expect(resolved).to.equal(false);

			await clock.tickAsync(1);
			expect(await pending).to.equal(false);
		});

		it("should resolve false immediately on non-retryable errors", async () => {
			const pending = redisService.waitForConnection(1000);

			clientListeners.error(new Error("invalid password"));

			expect(await pending).to.equal(false);
		});
	});

	describe("set", () => {
		it("should delete the key when ttl is zero", async () => {
			await redisService.set("key", "value", 0);

			expect(mockClient.del.calledOnceWith("key")).to.be.true;
			expect(mockClient.set.called).to.be.false;
			expect(mockClient.setEx.called).to.be.false;
		});
	});

	describe("setWithTags", () => {
		it("should use resilience wrapper", async () => {
			// Spy on withResilience
			const withResilienceSpy = sinon.spy(redisService as any, "withResilience");

			// Mock pipeline
			const pipelineStub = {
				set: sinon.stub(),
				setEx: sinon.stub(),
				sAdd: sinon.stub(),
				expire: sinon.stub(),
				persist: sinon.stub(),
				exec: sinon.stub().resolves(),
			};
			mockClient.multi.returns(pipelineStub);

			// Mock ensureSetKey (private)
			(redisService as any).ensureSetKey = sinon.stub().resolves();

			await redisService.setWithTags("key", "value", ["tag1"]);

			expect(withResilienceSpy.calledOnce).to.be.true;
			expect(pipelineStub.exec.calledOnce).to.be.true;
		});

		it("should keep tagged cache entries and metadata persistent when ttl is omitted", async () => {
			const pipelineStub = {
				set: sinon.stub(),
				setEx: sinon.stub(),
				sAdd: sinon.stub(),
				sRem: sinon.stub(),
				del: sinon.stub(),
				expire: sinon.stub(),
				persist: sinon.stub(),
				exec: sinon.stub().resolves(),
			};
			mockClient.multi.returns(pipelineStub);
			(redisService as any).ensureSetKey = sinon.stub().resolves();

			await redisService.setWithTags("key", "value", ["tag1"]);

			expect(pipelineStub.set.calledOnceWith("key", JSON.stringify("value"))).to.be.true;
			expect(pipelineStub.setEx.called).to.be.false;
			expect(pipelineStub.expire.called).to.be.false;
			expect(pipelineStub.persist.calledWith("tag:tag1")).to.be.true;
			expect(pipelineStub.persist.calledWith("key_tags:key")).to.be.true;
		});
	});

	describe("subscribe", () => {
		it("should not mutate the caller's channel array", async () => {
			(redisService as any).waitForConnection = sinon.stub().resolves(true);
			const subscriber = {
				isOpen: false,
				connect: sinon.stub().resolves(),
				subscribe: sinon.stub().resolves(),
				unsubscribe: sinon.stub().resolves(),
				quit: sinon.stub().resolves(),
			};
			mockClient.duplicate.returns(subscriber);
			const channels = ["feed_updates", "messaging_updates"];

			await redisService.subscribe(channels, () => undefined);

			expect(channels).to.deep.equal(["feed_updates", "messaging_updates"]);
		});
	});

	describe("invalidateByTags", () => {
		it("should remove invalidated keys from non-requested tag sets", async () => {
			const fetchPipeline = {
				sMembers: sinon.stub(),
				exec: sinon.stub().resolves([["cache:key"]]),
			};
			const keyTagsPipeline = {
				sMembers: sinon.stub(),
				exec: sinon.stub().resolves([["tag1", "tag2"]]),
			};
			const deletePipeline = {
				sRem: sinon.stub(),
				del: sinon.stub(),
				exec: sinon.stub().resolves(),
			};
			mockClient.multi.onCall(0).returns(fetchPipeline);
			mockClient.multi.onCall(1).returns(keyTagsPipeline);
			mockClient.multi.onCall(2).returns(deletePipeline);

			await redisService.invalidateByTags(["tag1"]);

			expect(fetchPipeline.sMembers.calledOnceWith("tag:tag1")).to.be.true;
			expect(keyTagsPipeline.sMembers.calledOnceWith("key_tags:cache:key")).to.be.true;
			expect(deletePipeline.sRem.calledOnceWith("tag:tag2", "cache:key")).to.be.true;
			expect(deletePipeline.del.calledWith("cache:key")).to.be.true;
			expect(deletePipeline.del.calledWith("key_tags:cache:key")).to.be.true;
			expect(deletePipeline.del.calledWith("tag:tag1")).to.be.true;
		});
	});
});
