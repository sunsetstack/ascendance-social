import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { RedisService } from "@/services/redis.service";
import { errorLogger } from "@/utils/winston";

function createDeferred(): {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
} {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("TransactionQueueService", () => {
	let transactionQueueService: TransactionQueueService;
	let unitOfWorkStub: sinon.SinonStubbedInstance<UnitOfWork>;
	let redisServiceStub: sinon.SinonStubbedInstance<RedisService>;
	let redisClientStub: any;

	beforeEach(() => {
		unitOfWorkStub = sinon.createStubInstance(UnitOfWork);

		// Default metrics mock
		unitOfWorkStub.getMetrics.returns({
			totalAttempts: 0,
			successfulTransactions: 0,
			failedTransactions: 0,
			retriedTransactions: 0,
			avgRetryCount: 0,
			currentQueueLength: 0,
			availablePermits: 50,
		});

		// Mock executeInTransaction to just run the callback
		unitOfWorkStub.executeInTransaction.callsFake(async (callback) => {
			return callback();
		});

		redisClientStub = {
			isOpen: true,
			lPush: sinon.stub().resolves(),
			rPush: sinon.stub().resolves(),
			lLen: sinon.stub().resolves(0),
			brPop: sinon.stub().callsFake(async () => {
				await new Promise(resolve => setTimeout(resolve, 10));
				return null;
			}),
			duplicate: sinon.stub().returnsThis(),
			connect: sinon.stub().resolves(),
			quit: sinon.stub().resolves(),
			del: sinon.stub().resolves(),
		};

		redisServiceStub = sinon.createStubInstance(RedisService) as any;
		Object.defineProperty(redisServiceStub, 'clientInstance', {
			get: () => redisClientStub
		});

		transactionQueueService = new TransactionQueueService(
			unitOfWorkStub as unknown as UnitOfWork,
			redisServiceStub as unknown as RedisService
		);
	});

	afterEach(() => {
		transactionQueueService.stopProcessing();
		sinon.restore();
	});

	describe("enqueue", () => {
		it("should enqueue a job correctly to Redis", async () => {
			await transactionQueueService.enqueue("testJob", { data: 123 }, { priority: "high" });

			expect(redisClientStub.lPush.calledOnce).to.be.true;
			const args = redisClientStub.lPush.firstCall.args;
			expect(args[0]).to.equal("queue:high");
            
			const payload = JSON.parse(args[1]);
			expect(payload.jobName).to.equal("testJob");
			expect(payload.payload.data).to.equal(123);
			expect(payload.priority).to.equal("high");
		});
	});

	describe("executeOrQueue", () => {
		beforeEach(() => {
			transactionQueueService.registerHandler("testJob", async (payload: any) => payload.result);
		});

		it("should execute immediately if system is not under load", async () => {
			unitOfWorkStub.getMetrics.returns({
				totalAttempts: 0,
				successfulTransactions: 0,
				failedTransactions: 0,
				retriedTransactions: 0,
				avgRetryCount: 0,
				currentQueueLength: 0,
				availablePermits: 50,
			});

			await transactionQueueService.executeOrQueue("testJob", { result: "immediate" });

			expect(unitOfWorkStub.executeInTransaction.calledOnce).to.be.true;
			expect(redisClientStub.lPush.called).to.be.false;
		});

		it("should queue to redis if system is under load", async () => {
			// Initial state: High load
			unitOfWorkStub.getMetrics.returns({
				totalAttempts: 0,
				successfulTransactions: 0,
				failedTransactions: 0,
				retriedTransactions: 0,
				avgRetryCount: 0,
				currentQueueLength: 50, // High load
				availablePermits: 0,
			});

			await transactionQueueService.executeOrQueue("testJob", { result: "queued" });

			expect(redisClientStub.lPush.calledOnce).to.be.true;
			expect(unitOfWorkStub.executeInTransaction.called).to.be.false;
			
			const args = redisClientStub.lPush.firstCall.args;
			expect(args[0]).to.equal("queue:normal"); // default priority
			const payload = JSON.parse(args[1]);
			expect(payload.jobName).to.equal("testJob");
		});

		it("should throw error if attempting to execute unregistered job immediately", async () => {
			unitOfWorkStub.getMetrics.returns({
				totalAttempts: 0,
				successfulTransactions: 0,
				failedTransactions: 0,
				retriedTransactions: 0,
				avgRetryCount: 0,
				currentQueueLength: 0,
				availablePermits: 50,
			});

			try {
				await transactionQueueService.executeOrQueue("unknownJob", {});
				expect.fail("Should have thrown error");
			} catch (e) {
				expect((e as Error).message).to.include("No handler registered");
			}
		});
	});

	describe("startup ownership", () => {
		it("shares one startup across overlapping enqueues and launches one process loop", async () => {
			const connection = createDeferred();
			const blockingClient = {
				isOpen: true,
				connect: sinon.stub().returns(connection.promise),
				disconnect: sinon.stub().resolves(),
				quit: sinon.stub().resolves(),
			};
			redisClientStub.duplicate.resetBehavior();
			redisClientStub.duplicate.returns(blockingClient);
			const processLoop = sinon
				.stub(transactionQueueService as any, "processLoop")
				.resolves();
			const startProcessing = sinon.spy(
				transactionQueueService,
				"startProcessing",
			);
			let firstResolved = false;
			let secondResolved = false;

			const firstEnqueue = transactionQueueService
				.enqueue("firstJob", {})
				.then(() => {
					firstResolved = true;
				});
			const secondEnqueue = transactionQueueService
				.enqueue("secondJob", {})
				.then(() => {
					secondResolved = true;
				});
			await Promise.resolve();
			await Promise.resolve();

			sinon.assert.calledOnce(redisClientStub.duplicate);
			sinon.assert.calledOnce(blockingClient.connect);
			sinon.assert.calledTwice(startProcessing);
			expect(startProcessing.returnValues[0]).to.equal(
				startProcessing.returnValues[1],
			);
			expect(firstResolved).to.equal(false);
			expect(secondResolved).to.equal(false);
			sinon.assert.notCalled(processLoop);

			connection.resolve();
			await Promise.all([firstEnqueue, secondEnqueue]);

			expect(firstResolved).to.equal(true);
			expect(secondResolved).to.equal(true);
			sinon.assert.calledOnce(processLoop);
			sinon.assert.calledWithExactly(processLoop, blockingClient);
			expect((transactionQueueService as any).isProcessing).to.equal(true);
			expect((transactionQueueService as any).startupPromise).to.equal(null);
		});

		it("shares the original startup failure and permits a later retry", async () => {
			const connection = createDeferred();
			const startupError = new Error("blocking client connection failed");
			const failedClient = {
				isOpen: true,
				connect: sinon.stub().returns(connection.promise),
				disconnect: sinon.stub().resolves(),
				quit: sinon.stub().resolves(),
			};
			const retryClient = {
				isOpen: true,
				connect: sinon.stub().resolves(),
				disconnect: sinon.stub().resolves(),
				quit: sinon.stub().resolves(),
			};
			redisClientStub.duplicate.onFirstCall().returns(failedClient);
			redisClientStub.duplicate.onSecondCall().returns(retryClient);
			const processLoop = sinon
				.stub(transactionQueueService as any, "processLoop")
				.resolves();

			const firstEnqueue = transactionQueueService.enqueue("firstJob", {});
			const secondEnqueue = transactionQueueService.enqueue("secondJob", {});
			await Promise.resolve();
			await Promise.resolve();
			connection.reject(startupError);

			const [firstResult, secondResult] = await Promise.allSettled([
				firstEnqueue,
				secondEnqueue,
			]);

			expect(firstResult.status).to.equal("rejected");
			expect(secondResult.status).to.equal("rejected");
			expect((firstResult as PromiseRejectedResult).reason).to.equal(
				startupError,
			);
			expect((secondResult as PromiseRejectedResult).reason).to.equal(
				startupError,
			);
			sinon.assert.calledOnce(redisClientStub.duplicate);
			sinon.assert.calledOnce(failedClient.connect);
			sinon.assert.calledOnce(failedClient.disconnect);
			sinon.assert.notCalled(processLoop);
			expect((transactionQueueService as any).isProcessing).to.equal(false);
			expect((transactionQueueService as any).blockingClient).to.equal(null);
			expect((transactionQueueService as any).startupPromise).to.equal(null);

			await transactionQueueService.enqueue("retryJob", {});

			sinon.assert.calledTwice(redisClientStub.duplicate);
			sinon.assert.calledOnce(retryClient.connect);
			sinon.assert.calledOnce(processLoop);
			sinon.assert.calledWithExactly(processLoop, retryClient);
			expect((transactionQueueService as any).isProcessing).to.equal(true);
			expect((transactionQueueService as any).startupPromise).to.equal(null);
		});

		it("does not launch a consumer when stopped during startup", async () => {
			const connection = createDeferred();
			const blockingClient = {
				isOpen: true,
				connect: sinon.stub().returns(connection.promise),
				disconnect: sinon.stub().resolves(),
				quit: sinon.stub().resolves(),
			};
			redisClientStub.duplicate.resetBehavior();
			redisClientStub.duplicate.returns(blockingClient);
			const processLoop = sinon
				.stub(transactionQueueService as any, "processLoop")
				.resolves();

			const startup = transactionQueueService.startProcessing();
			transactionQueueService.stopProcessing();
			connection.resolve();
			const [result] = await Promise.allSettled([startup]);

			expect(result?.status).to.equal("rejected");
			sinon.assert.notCalled(processLoop);
			sinon.assert.calledOnce(blockingClient.quit);
			expect((transactionQueueService as any).isProcessing).to.equal(false);
			expect((transactionQueueService as any).blockingClient).to.equal(null);
			expect((transactionQueueService as any).startupPromise).to.equal(null);
		});
	});

	describe("getMetrics", () => {
		it("should retrieve queue sizes from redis", async () => {
			redisClientStub.lLen.resolves(5);
			
			const metrics = await transactionQueueService.getMetrics();
			
			expect(redisClientStub.lLen.callCount).to.equal(4); // once for each priority
			expect(metrics.queueSizes.critical).to.equal(5);
			expect(metrics.queueSizes.low).to.equal(5);
		});
	});

	describe("process loop terminal boundary", () => {
		it("owns an unexpected process loop rejection exactly once", async () => {
			const logError = sinon.stub(errorLogger, "error");
			(transactionQueueService as any).processLoop = sinon
				.stub()
				.rejects(new Error("process loop crashed"));

			await transactionQueueService.startProcessing();
			await new Promise((resolve) => setImmediate(resolve));

			expect((transactionQueueService as any).isProcessing).to.equal(false);
			sinon.assert.calledOnce(logError);
			expect(logError.firstCall.args[0]).to.include({
				event: "background.transaction_queue.process_loop.crashed",
				worker: "TransactionQueueService",
				operation: "process_loop",
			});
		});
	});
});
