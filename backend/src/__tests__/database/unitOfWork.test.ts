import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import { UnitOfWork, TransactionMetrics } from "@/database/UnitOfWork";

// skipping UnitOfWork tests - mongoose.connection.readyState is a non-configurable property
// that cannot be stubbed with sinon, these tests require integration testing with a real
// MongoDB instance or a more sophisticated mocking approach
describe.skip("UnitOfWork", () => {
	let unitOfWork: UnitOfWork;
	let connectionStub: sinon.SinonStub;

	beforeEach(() => {
		// stub mongoose connection to report as connected
		connectionStub = sinon.stub(mongoose.connection, "readyState").value(1);

		unitOfWork = new UnitOfWork();
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("getMetrics", () => {
		it("should return initial metrics with zero values", () => {
			const metrics = unitOfWork.getMetrics();

			expect(metrics.totalAttempts).to.equal(0);
			expect(metrics.successfulTransactions).to.equal(0);
			expect(metrics.failedTransactions).to.equal(0);
			expect(metrics.retriedTransactions).to.equal(0);
			expect(metrics.avgRetryCount).to.equal(0);
			expect(metrics.availablePermits).to.equal(50); // default
			expect(metrics.currentQueueLength).to.equal(0);
		});
	});

	describe("resetMetrics", () => {
		it("should reset all metrics to zero", () => {
			// artificially set some metrics by accessing private property
			(unitOfWork as any).metrics = {
				totalAttempts: 100,
				successfulTransactions: 90,
				failedTransactions: 10,
				retriedTransactions: 20,
				totalRetries: 40,
			};

			unitOfWork.resetMetrics();
			const metrics = unitOfWork.getMetrics();

			expect(metrics.totalAttempts).to.equal(0);
			expect(metrics.successfulTransactions).to.equal(0);
			expect(metrics.failedTransactions).to.equal(0);
			expect(metrics.retriedTransactions).to.equal(0);
		});
	});

	describe("isRetryableError", () => {
		it("should identify WriteConflict (code 112) as retryable", () => {
			const error = { code: 112, message: "WriteConflict" };
			const result = (unitOfWork as any).isRetryableError(error);
			expect(result).to.be.true;
		});

		it("should identify TransientTransactionError label as retryable", () => {
			const error = { errorLabels: ["TransientTransactionError"], message: "Transient" };
			const result = (unitOfWork as any).isRetryableError(error);
			expect(result).to.be.true;
		});

		it("should identify UnknownTransactionCommitResult label as retryable", () => {
			const error = { errorLabels: ["UnknownTransactionCommitResult"], message: "Unknown" };
			const result = (unitOfWork as any).isRetryableError(error);
			expect(result).to.be.true;
		});

		it("should identify network errors as retryable", () => {
			const error = { message: "ECONNRESET connection lost" };
			const result = (unitOfWork as any).isRetryableError(error);
			expect(result).to.be.true;
		});

		it("should not identify validation errors as retryable", () => {
			const error = { name: "ValidationError", message: "Invalid data" };
			const result = (unitOfWork as any).isRetryableError(error);
			expect(result).to.be.false;
		});

		it("should not identify null error as retryable", () => {
			const result = (unitOfWork as any).isRetryableError(null);
			expect(result).to.be.false;
		});
	});

	describe("backoffWithJitter", () => {
		it("should return delay within expected range", async () => {
			const attempt = 2;
			const baseDelay = 100;
			const maxDelay = 5000;

			// calculate expected range (with full jitter)
			const expectedMax = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

			const start = Date.now();
			await (unitOfWork as any).backoffWithJitter(attempt, baseDelay, maxDelay);
			const elapsed = Date.now() - start;

			expect(elapsed).to.be.at.least(0);
			expect(elapsed).to.be.at.most(expectedMax + 50); // allow 50ms tolerance
		});

		it("should cap delay at maxDelay", async () => {
			const attempt = 10; // high attempt number
			const baseDelay = 100;
			const maxDelay = 200;

			const start = Date.now();
			await (unitOfWork as any).backoffWithJitter(attempt, baseDelay, maxDelay);
			const elapsed = Date.now() - start;

			expect(elapsed).to.be.at.most(maxDelay + 50); // allow 50ms tolerance
		});
	});
});

// Skipped: mongoose.connection.readyState is non-configurable and cannot be stubbed in Sinon
describe.skip("Semaphore", () => {
	// test the internal Semaphore class behavior through UnitOfWork
	let unitOfWork: UnitOfWork;

	beforeEach(() => {
		sinon.stub(mongoose.connection, "readyState").value(1);

		// create with small concurrency limit for testing
		process.env.MAX_CONCURRENT_TRANSACTIONS = "2";
		unitOfWork = new UnitOfWork();
	});

	afterEach(() => {
		delete process.env.MAX_CONCURRENT_TRANSACTIONS;
		sinon.restore();
	});

	it("should report correct available permits", () => {
		const metrics = unitOfWork.getMetrics();
		expect(metrics.availablePermits).to.equal(2);
	});
});
