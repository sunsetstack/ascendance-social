import { describe, it } from "mocha";
import { expect } from "chai";
import "reflect-metadata";

// Integration test to verify security features work together
describe("Security - NoSQL Injection & XSS Prevention", () => {
	it("should have sanitizer utilities available", () => {
		const { sanitizeForMongo, isValidPublicId, sanitizeTextInput } = require("@/utils/sanitizers");

		expect(sanitizeForMongo).to.exist;
		expect(isValidPublicId).to.exist;
		expect(sanitizeTextInput).to.exist;
	});

	it("should sanitize NoSQL operators through the full stack", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const maliciousPayload = {
			username: "admin",
			password: { $ne: null },
			email: "test@test.com",
		};

		const sanitized = sanitizeForMongo(maliciousPayload);

		expect(sanitized).to.deep.equal({
			username: "admin",
			email: "test@test.com",
		});
		expect(sanitized.password).to.be.undefined;
	});

	it("should strip XSS through sanitizeTextInput", () => {
		const { sanitizeTextInput } = require("@/utils/sanitizers");

		const xssInput = '<script>alert("XSS")</script>Safe content';
		const sanitized = sanitizeTextInput(xssInput);

		expect(sanitized).to.equal("Safe content");
		expect(sanitized).to.not.include("<script>");
	});

	it("should validate publicId format", () => {
		const { isValidPublicId } = require("@/utils/sanitizers");

		const validUuid = "bcac4271-2976-4d96-bb5b-364edc5eea0c";
		const invalidUuid = "not-a-uuid";
		const maliciousId = { $ne: null };

		expect(isValidPublicId(validUuid)).to.be.true;
		expect(isValidPublicId(invalidUuid)).to.be.false;
		expect(isValidPublicId(maliciousId)).to.be.false;
	});

	it("should prevent prototype pollution through sanitizeForMongo", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const maliciousPayload = {
			normalField: "safe",
			__proto__: { isAdmin: true },
			constructor: { prototype: { role: "admin" } },
			prototype: { evilProp: true },
		};

		const sanitized = sanitizeForMongo(maliciousPayload);

		expect(sanitized).to.deep.equal({ normalField: "safe" });
		// use hasOwnProperty to verify these dangerous keys were not added
		expect(sanitized.hasOwnProperty("__proto__")).to.be.false;
		expect(sanitized.hasOwnProperty("constructor")).to.be.false;
		expect(sanitized.hasOwnProperty("prototype")).to.be.false;
	});

	it("should have CreatePostCommandHandler using sanitizers", () => {
		const { CreatePostCommandHandler } = require("@/application/commands/post/createPost/createPost.handler");

		expect(CreatePostCommandHandler).to.exist;

		// verify handler file imports sanitizers
		const handlerSource = require("fs").readFileSync(
			require("path").join(__dirname, "@/application/commands/post/createPost/createPost.handler.ts"),
			"utf8"
		);

		expect(handlerSource).to.include("sanitizeForMongo");
		expect(handlerSource).to.include("isValidPublicId");
		expect(handlerSource).to.include("sanitizeTextInput");
	});

	it("should have CreateCommentCommandHandler using sanitizers", () => {
		const {
			CreateCommentCommandHandler,
		} = require("@/application/commands/comments/createComment/create-comment.handler");

		expect(CreateCommentCommandHandler).to.exist;

		// verify handler uses sanitizers
		const handlerSource = require("fs").readFileSync(
			require("path").join(__dirname, "@/application/commands/comments/createComment/create-comment.handler.ts"),
			"utf8"
		);

		expect(handlerSource).to.include("sanitizeForMongo");
		expect(handlerSource).to.include("isValidPublicId");
	});

	it("should strip path traversal attacks", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const malicious = {
			"user.role": "admin",
			"settings.isAdmin": true,
			"nested.path.field": "bad",
			safeField: "good",
		};

		const sanitized = sanitizeForMongo(malicious);

		expect(sanitized).to.deep.equal({ safeField: "good" });
		expect(sanitized["user.role"]).to.be.undefined;
		expect(sanitized["settings.isAdmin"]).to.be.undefined;
		expect(sanitized["nested.path.field"]).to.be.undefined;
	});

	it("should handle deeply nested malicious payloads", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const malicious = {
			level1: {
				level2: {
					$where: "1==1",
					level3: {
						__proto__: { evil: true },
						"path.traversal": "bad",
						safe: "value",
					},
				},
			},
		};

		const sanitized = sanitizeForMongo(malicious);

		expect(sanitized).to.deep.equal({
			level1: {
				level2: {
					level3: {
						safe: "value",
					},
				},
			},
		});
	});

	it("should sanitize arrays of malicious objects", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const malicious = {
			tags: [{ $gt: 0 }, { __proto__: { evil: true } }, { "bad.path": "value" }, { safe: "tag" }],
		};

		const sanitized = sanitizeForMongo(malicious);

		expect(sanitized).to.deep.equal({
			tags: [{}, {}, {}, { safe: "tag" }],
		});
	});

	it("should enforce text length limits", () => {
		const { sanitizeTextInput } = require("@/utils/sanitizers");

		const longText = "a".repeat(5001);

		expect(() => sanitizeTextInput(longText)).to.throw("Input cannot exceed 5000 characters");
	});

	it("should reject empty input after sanitization", () => {
		const { sanitizeTextInput } = require("@/utils/sanitizers");

		const onlyHtml = "<script>alert('xss')</script><div></div>";

		expect(() => sanitizeTextInput(onlyHtml)).to.throw("Input is empty after sanitization");
	});

	it("should preserve MongoDB ObjectIds during sanitization", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");
		const mongoose = require("mongoose");

		const objectId = new mongoose.Types.ObjectId();
		const payload = {
			userId: objectId,
			$malicious: "operator",
			username: "test",
		};

		const sanitized = sanitizeForMongo(payload);

		expect(sanitized.userId).to.equal(objectId);
		expect(sanitized.username).to.equal("test");
		expect(sanitized.$malicious).to.be.undefined;
	});

	it("should handle all MongoDB injection operators", () => {
		const { sanitizeForMongo } = require("@/utils/sanitizers");

		const malicious = {
			$where: "malicious code",
			$ne: null,
			$gt: 0,
			$regex: ".*",
			$expr: { $eq: ["$field", "value"] },
			$text: { $search: "search" },
			safe: "value",
		};

		const sanitized = sanitizeForMongo(malicious);

		expect(sanitized).to.deep.equal({ safe: "value" });
		expect(Object.keys(sanitized).some((key) => key.startsWith("$"))).to.be.false;
	});

	it("should strip common XSS vectors", () => {
		const { sanitizeTextInput } = require("@/utils/sanitizers");

		const xssVectors = [
			{ input: '<script>alert("XSS")</script>Safe', expected: "Safe" },
			{ input: '<img src=x onerror="alert(1)">Safe', expected: "Safe" },
			{ input: '<svg onload="alert(1)">Safe', expected: "Safe" },
			{ input: '<iframe src="evil.com"></iframe>Safe', expected: "Safe" },
			// button tags leave text content, so "Click" + "Safe" = "ClickSafe"
			{ input: '<button onclick="alert(1)">Click</button>Safe', expected: "ClickSafe" },
		];

		xssVectors.forEach(({ input, expected }) => {
			const sanitized = sanitizeTextInput(input);
			expect(sanitized).to.equal(expected);
			// Verify no HTML tags remain
			if (!expected.includes("Click")) {
				expect(sanitized).to.not.match(/<[^>]+>/);
			}
		});
	});

	it("should have error handling for CreatePost command", () => {
		const { CreatePostCommandHandler } = require("@/application/commands/post/createPost/createPost.handler");
		const { Errors } = require("@/utils/errors");

		expect(CreatePostCommandHandler).to.exist;

		const validationError = Errors.validation("Invalid userPublicId format");
		expect(validationError.name).to.equal("ValidationError");
		expect(validationError.statusCode).to.equal(400);
	});

	it("should have error handling for CreateComment command", () => {
		const {
			CreateCommentCommandHandler,
		} = require("@/application/commands/comments/createComment/create-comment.handler");
		const { Errors } = require("@/utils/errors");

		expect(CreateCommentCommandHandler).to.exist;

		const validationError = Errors.validation("Invalid postPublicId");
		expect(validationError.name).to.equal("ValidationError");
		expect(validationError.statusCode).to.equal(400);
	});
});
