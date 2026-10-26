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
import type {
  AdminUserDTO,
  AuthenticatedUserDTO,
} from "@/services/dto.service";

const user: AuthenticatedUserDTO = {
  publicId: asUserPublicId("de802f94-f823-4d87-a535-144b904f10ac"),
  email: "test@example.com",
  handle: "test-handle",
  username: "test-user",
  isEmailVerified: true,
  avatar: "",
  cover: "",
  bio: "",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  postCount: 0,
  followerCount: 0,
  followingCount: 0,
};

describe("user auth response helpers", () => {
  it("scopes refresh cookies to the refresh route", () => {
    expect(refreshCookieOptions.path).to.equal("/api/users/refresh");
    expect(clearRefreshCookieOptions.path).to.equal("/api/users/refresh");
  });

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

  it("maps an admin DTO and propagates the supplied authVersion", () => {
    const admin: AdminUserDTO = {
      ...user,
      isAdmin: true,
      isBanned: false,
      updatedAt: user.createdAt,
    };
    const result = toSessionUser(admin, 2);

    expect(result).to.deep.equal({
      publicId: user.publicId,
      email: "test@example.com",
      handle: "test-handle",
      username: "test-user",
      isAdmin: true,
      isEmailVerified: true,
      authVersion: 2,
    });
  });

  it("maps a regular DTO as non-admin and preserves authVersion", () => {
    for (const authVersion of [0, 7]) {
      expect(toSessionUser(user, authVersion)).to.deep.equal({
        publicId: user.publicId,
        email: user.email,
        handle: user.handle,
        username: user.username,
        isAdmin: false,
        isEmailVerified: true,
        authVersion,
      });
    }
  });

  it("preserves unverified user's email verification state", () => {
    expect(toSessionUser({ ...user, isEmailVerified: false }, 4)).to.deep.equal(
      {
        publicId: user.publicId,
        email: user.email,
        handle: user.handle,
        username: user.username,
        isAdmin: false,
        isEmailVerified: false,
        authVersion: 4,
      },
    );
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
    expect(
      (res.clearCookie as sinon.SinonStub).calledOnceWith(
        authCookieNames.legacyToken,
        clearAuthCookieOptions,
      ),
    ).to.be.true;
  });

  it("clears all auth cookies", () => {
    const res = {
      clearCookie: sinon.stub().returnsThis(),
    } as unknown as Response;

    clearAuthCookies(res);

    expect(
      (res.clearCookie as sinon.SinonStub).getCalls().map((call) => call.args),
    ).to.deep.equal([
      [authCookieNames.accessToken, clearAuthCookieOptions],
      [authCookieNames.refreshToken, clearRefreshCookieOptions],
      [authCookieNames.legacyToken, clearAuthCookieOptions],
    ]);
  });
});
