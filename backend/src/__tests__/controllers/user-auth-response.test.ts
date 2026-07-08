import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import type { Request, Response } from "express";
import {
	accessCookieOptions,
	authCookieNames,
	clearAuthCookieOptions,
	clearRefreshCookieOptions,
	refreshCookieOptions,
} from "@/config/cookieConfig";
import {
	buildAuthRequestContext,
	clearAuthCookies,
	setAuthCookies,
	toSessionUser,
} from "@/controllers/helpers/user-auth-response";
import { asUserPublicId } from "@/types/branded";

describe("user auth response helpers", () => {
	it("builds request context from the trusted request IP", () => {
		const req = {
			headers: {
				"x-forwarded-for": "203.0.113.10:443",
			},
			get: sinon.stub().withArgs("User-Agent").returns("Mozilla/Test"),
			ip: "127.0.0.1",
			socket: { remoteAddress: "127.0.0.1" },
		} as unknown as Request;

		const result = buildAuthRequestContext(req);

		expect(result).to.deep.equal({
			ip: "127.0.0.1",
			userAgent: "Mozilla/Test",
		});
	});

	it("maps DTOs into the session user shape", () => {
		const result = toSessionUser({
			publicId: asUserPublicId("user-public-id"),
			email: "test@example.com",
			handle: "test-handle",
			username: "test-user",
			isAdmin: true,
			isEmailVerified: true,
		} as Parameters<typeof toSessionUser>[0]);

		expect(result).to.deep.equal({
			publicId: asUserPublicId("user-public-id"),
			email: "test@example.com",
			handle: "test-handle",
			username: "test-user",
			isAdmin: true,
			isEmailVerified: true,
		});
	});

	it("sets auth cookies and clears the legacy cookie", () => {
		const res = {
			cookie: sinon.stub().returnsThis(),
			clearCookie: sinon.stub().returnsThis(),
		} as unknown as Response;

		setAuthCookies(res, "access-token", "refresh-token");

		expect((res.cookie as sinon.SinonStub).firstCall.args).to.deep.equal([
			authCookieNames.accessToken,
			"access-token",
			accessCookieOptions,
		]);
		expect((res.cookie as sinon.SinonStub).secondCall.args).to.deep.equal([
			authCookieNames.refreshToken,
			"refresh-token",
			refreshCookieOptions,
		]);
		expect((res.clearCookie as sinon.SinonStub).calledOnceWith(
			authCookieNames.legacyToken,
			clearAuthCookieOptions,
		)).to.be.true;
	});

	it("clears all auth cookies", () => {
		const res = {
			clearCookie: sinon.stub().returnsThis(),
		} as unknown as Response;

		clearAuthCookies(res);

		expect((res.clearCookie as sinon.SinonStub).getCalls().map((call) => call.args)).to.deep.equal([
			[authCookieNames.accessToken, clearAuthCookieOptions],
			[authCookieNames.refreshToken, clearRefreshCookieOptions],
			[authCookieNames.legacyToken, clearAuthCookieOptions],
		]);
	});
});
