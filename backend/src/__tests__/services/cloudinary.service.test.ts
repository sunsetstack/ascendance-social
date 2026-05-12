import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { CloudinaryService } from "@/services/cloudinary.service";
import { RetryService } from "@/services/retry.service";

describe("CloudinaryService", () => {
	let cloudinaryService: CloudinaryService;
	let retryServiceStub: sinon.SinonStubbedInstance<RetryService>;

	beforeEach(() => {
		retryServiceStub = sinon.createStubInstance(RetryService);
		// mock execute to just run the operation once
		retryServiceStub.execute.callsFake(async (op) => op());

		cloudinaryService = new CloudinaryService(retryServiceStub as unknown as RetryService);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe("isCloudinaryRetryable", () => {
		it("should identify timeout errors as retryable", () => {
			const error = { message: "Request timeout exceeded" };
			const result = (cloudinaryService as any).isCloudinaryRetryable(error);
			expect(result).to.be.true;
		});

		it("should identify ECONNRESET as retryable", () => {
			const error = { message: "ECONNRESET: connection reset by peer" };
			const result = (cloudinaryService as any).isCloudinaryRetryable(error);
			expect(result).to.be.true;
		});

		it("should identify rate limit errors as retryable", () => {
			const error = { message: "Rate limit exceeded" };
			const result = (cloudinaryService as any).isCloudinaryRetryable(error);
			expect(result).to.be.true;
		});

		it("should identify 503 errors as retryable", () => {
			const error = { message: "Service unavailable 503" };
			const result = (cloudinaryService as any).isCloudinaryRetryable(error);
			expect(result).to.be.true;
		});

		it("should not identify validation errors as retryable", () => {
			const error = { message: "Invalid image format" };
			const result = (cloudinaryService as any).isCloudinaryRetryable(error);
			expect(result).to.be.false;
		});

		it("should not identify null as retryable", () => {
			const result = (cloudinaryService as any).isCloudinaryRetryable(null);
			expect(result).to.be.false;
		});
	});

	describe("extractPublicId", () => {
		it("should extract public ID from Cloudinary URL", () => {
			const url = "https://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg";
			const result = (cloudinaryService as any).extractPublicId(url);
			expect(result).to.equal("v1234567890/sample");
		});

		it("should extract public ID from URL with folder", () => {
			const url = "https://res.cloudinary.com/demo/image/upload/v1234567890/folder/image.png";
			const result = (cloudinaryService as any).extractPublicId(url);
			expect(result).to.equal("folder/image");
		});

		it("should return null for invalid URL", () => {
			const url = "not-a-valid-url";
			const result = (cloudinaryService as any).extractPublicId(url);
			expect(result).to.be.null;
		});
	});

	describe("uploadImage", () => {
		it("should use retry service with external API preset", async () => {
			// setup mock to track call arguments
			let capturedConfig: any;
			retryServiceStub.execute.callsFake(async (op, config) => {
				capturedConfig = config;
				// don't actually call cloudinary
				return { url: "https://example.com/image.jpg", publicId: "test-id" };
			});

			await cloudinaryService.uploadImage("/tmp/test.jpg", "user-123");

			expect(retryServiceStub.execute.calledOnce).to.be.true;
			expect(capturedConfig).to.have.property("shouldRetry");
			expect(capturedConfig).to.have.property("maxAttempts");
		});
	});

	describe("deleteAssetByUrl", () => {
		it("should handle invalid URL by skipping", async () => {
			const result = await cloudinaryService.deleteAssetByUrl("user", "", "invalid-url");
			expect(result).to.deep.equal({ result: "skipped" });
		});

		it("should use retry service for deletion", async () => {
			retryServiceStub.execute.callsFake(async () => ({ result: "ok" }));

			const result = await cloudinaryService.deleteAssetByUrl(
				"user",
				"",
				"https://res.cloudinary.com/demo/image/upload/v123/test.jpg",
			);

			expect(retryServiceStub.execute.calledOnce).to.be.true;
			expect(result).to.deep.equal({ result: "ok" });
		});
	});
});
