import { expect } from "chai";
import { describe, it } from "mocha";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import sinon from "sinon";
import {
  AuthenticationMiddleware,
  AuthStrategy,
  BearerTokenStrategy,
} from "@/middleware/authentication.middleware";
import { correlationIdMiddleware } from "@/middleware/correlationId.middleware";
import type { UserIdentityLookup } from "@/application/ports/user-identity-lookup";
import { getRequestContext } from "@/runtime/request-context";
import { asSessionId, asUserPublicId } from "@/types/branded";
import type { DecodedUser } from "@/types";
import { ErrorCode, ErrorHandler, Errors } from "@/utils/errors";
import { errorLogger, logger } from "@/utils/winston";

describe("AuthenticationMiddleware", () => {
  function buildUnverifiedRequest() {
    const decodedUser: DecodedUser = {
      publicId: asUserPublicId("11111111-1111-4111-8111-111111111111"),
      email: "unverified@example.com",
      handle: "unverified",
      username: "Unverified",
      sid: asSessionId("22222222-2222-4222-8222-222222222222"),
      isAdmin: false,
      isEmailVerified: false,
    };
    const strategy = {
      authenticate: sinon.stub().resolves(decodedUser),
    } as unknown as AuthStrategy;
    const userReadRepository = {
      findByPublicId: sinon.stub().resolves({
        publicId: decodedUser.publicId,
        isAdmin: false,
        isBanned: false,
        isEmailVerified: false,
      }),
    } as unknown as UserIdentityLookup;
    const middleware = new AuthenticationMiddleware(
      strategy,
      userReadRepository,
      null,
    );
    const request = {
      method: "DELETE",
      originalUrl: "/api/users/me",
      baseUrl: "/api/users",
      path: "/me",
      headers: {},
    } as Request;
    const next = sinon.stub();

    return { decodedUser, middleware, request, next };
  }

  it("allows an authenticated unverified user when the route opts in", async () => {
    const { decodedUser, middleware, request, next } = buildUnverifiedRequest();

    await middleware.handle({ allowUnverified: true })(
      request,
      {} as Response,
      next,
    );

    expect(next.calledOnceWithExactly()).to.equal(true);
    expect(request.decodedUser).to.equal(decodedUser);
    expect(request.decodedUser?.isEmailVerified).to.equal(false);
  });

  it("enriches context through correlation, authentication, and awaited route work", async () => {
    const { decodedUser, middleware, request } = buildUnverifiedRequest();
    (request as Request & { get: (header: string) => string | undefined }).get =
      sinon
        .stub()
        .callsFake((header: string) =>
          header === "x-request-id" ? "request-abc" : undefined,
        );
    const response = { setHeader: sinon.stub() } as unknown as Response;

    await new Promise<void>((resolve, reject) => {
      correlationIdMiddleware(request, response, () => {
        void middleware.handle({ allowUnverified: true })(
          request,
          response,
          (error?: unknown) => {
            if (error) {
              reject(error);
              return;
            }

            void (async () => {
              try {
                await Promise.resolve();
                expect(getRequestContext()).to.deep.include({
                  correlationId: "request-abc",
                  userId: decodedUser.publicId,
                });
                resolve();
              } catch (assertionError) {
                reject(assertionError);
              }
            })();
          },
        );
      });
    });
  });

  it("continues to reject unverified users on ordinary protected routes", async () => {
    const { middleware, request, next } = buildUnverifiedRequest();

    await middleware.handle()(request, {} as Response, next);

    expect(next.calledOnce).to.equal(true);
    expect(next.firstCall.args[0]).to.include({
      message: "Email verification required",
      statusCode: 403,
    });
  });

  it("continues anonymously when optional authentication has no credentials", async () => {
    const strategy = new BearerTokenStrategy("test-secret", {
      assertAccessSession: sinon.stub(),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: {},
    } as Request;
    const next = sinon.stub();
    const warn = sinon.stub(logger, "warn");

    try {
      await middleware.handleOptional()(request, {} as Response, next);

      expect(next.calledOnceWithExactly()).to.equal(true);
      expect(request.decodedUser).to.equal(undefined);
      expect(request.authSource).to.equal(undefined);
      sinon.assert.notCalled(warn);
    } finally {
      warn.restore();
    }
  });

  it("keeps missing credentials as a required-auth 401", async () => {
    const strategy = new BearerTokenStrategy("test-secret", {
      assertAccessSession: sinon.stub(),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: {},
    } as Request;
    const next = sinon.stub();

    await middleware.handle()(request, {} as Response, next);

    expect(next.calledOnce).to.equal(true);
    expect(next.firstCall.args[0]).to.include({
      statusCode: 401,
      errorCode: ErrorCode.TOKEN_INVALID,
    });
  });

  it("keeps malformed bearer tokens as authentication failures", async () => {
    const strategy = new BearerTokenStrategy("test-secret", {
      assertAccessSession: sinon.stub(),
    } as never);
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      headers: { authorization: "Bearer malformed-token" },
    } as Request;

    try {
      await strategy.authenticate(request);
      expect.fail("Expected malformed token authentication to fail");
    } catch (error) {
      expect(error).to.include({
        statusCode: 401,
        errorCode: ErrorCode.TOKEN_INVALID,
      });
      expect(error).to.have.nested.property("cause.name", "JsonWebTokenError");
    }
  });

  it("preserves explicit invalid-session authentication errors as 401s", async () => {
    const invalidSession = Errors.authentication(
      "Session is invalid or expired",
    );
    const strategy = {
      authenticate: sinon.stub().rejects(invalidSession),
    } as unknown as AuthStrategy;
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: {},
    } as Request;
    const next = sinon.stub();

    await middleware.handle()(request, {} as Response, next);

    expect(next.calledOnceWithExactly(invalidSession)).to.equal(true);
    expect(next.firstCall.args[0]).to.include({ statusCode: 401 });
  });

  it("continues anonymously for malformed and expired optional bearer tokens", async () => {
    const secret = "test-secret";
    const strategy = new BearerTokenStrategy(secret, {
      assertAccessSession: sinon.stub(),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const expiredToken = jwt.sign(
      {
        publicId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        username: "User",
        handle: "user",
        sid: "22222222-2222-4222-8222-222222222222",
      },
      secret,
      { expiresIn: -1 },
    );

    for (const authorization of [
      "Bearer malformed-token",
      `Bearer ${expiredToken}`,
    ]) {
      const request = {
        method: "GET",
        originalUrl: "/api/posts",
        baseUrl: "/api",
        path: "/posts",
        headers: { authorization },
      } as Request;
      const next = sinon.stub();

      await middleware.handleOptional()(request, {} as Response, next);

      expect(next.calledOnceWithExactly()).to.equal(true);
      expect(request.decodedUser).to.equal(undefined);
      expect(request.authSource).to.equal(undefined);
    }
  });

  it("classifies wrapped JWT causes for optional-auth metrics and warnings", async () => {
    const cases: Array<{
      cause: jwt.JsonWebTokenError;
      reason: "token_expired" | "token_not_active" | "invalid_token";
    }> = [
      {
        cause: new jwt.TokenExpiredError("not active", new Date()),
        reason: "token_expired",
      },
      {
        cause: new jwt.NotBeforeError("expired", new Date()),
        reason: "token_not_active",
      },
      {
        cause: new jwt.JsonWebTokenError("expired"),
        reason: "invalid_token",
      },
    ];
    const metrics = {
      recordOptionalAuthFailure: sinon.stub(),
    };
    const warn = sinon.stub(logger, "warn");

    try {
      for (const { cause, reason } of cases) {
        const middleware = new AuthenticationMiddleware(
          {
            authenticate: sinon
              .stub()
              .rejects(Errors.authentication("Authentication failed", { cause })),
          } as unknown as AuthStrategy,
      {} as UserIdentityLookup,
          metrics as never,
        );
        const request = {
          method: "GET",
          originalUrl: "/api/posts",
          baseUrl: "/api",
          path: "/posts",
          headers: { authorization: "Bearer presented-token" },
        } as Request;
        const next = sinon.stub();
        const handleOptional = middleware.handleOptional() as unknown as (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => Promise<void>;

        await handleOptional(request, {} as Response, next);

        expect(next.calledOnceWithExactly()).to.equal(true);
        sinon.assert.calledOnce(metrics.recordOptionalAuthFailure);
        sinon.assert.calledWithExactly(
          metrics.recordOptionalAuthFailure,
          reason,
          "/api/posts",
        );
        sinon.assert.calledOnce(warn);
        const warningMetadata = (
          warn.firstCall.args as unknown as [
            message: string,
            metadata: { reason: string; route: string },
          ]
        )[1];
        expect(warningMetadata).to.include({
          reason,
          route: "/api/posts",
        });
        metrics.recordOptionalAuthFailure.resetHistory();
        warn.resetHistory();
      }
    } finally {
      warn.restore();
    }
  });

  it("continues anonymously for an expected invalid optional session", async () => {
    const secret = "test-secret";
    const strategy = new BearerTokenStrategy(secret, {
      assertAccessSession: sinon
        .stub()
        .rejects(Errors.authentication("Session is invalid or expired")),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const token = jwt.sign(
      {
        publicId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        username: "User",
        handle: "user",
        sid: "22222222-2222-4222-8222-222222222222",
      },
      secret,
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: { authorization: `Bearer ${token}` },
    } as Request;
    const next = sinon.stub();

    await middleware.handleOptional()(request, {} as Response, next);

    expect(next.calledOnceWithExactly()).to.equal(true);
    expect(request.decodedUser).to.equal(undefined);
    expect(request.authSource).to.equal(undefined);
  });

  it("continues anonymously for an unverified user but propagates a banned user", async () => {
    const decodedUser: DecodedUser = {
      publicId: asUserPublicId("11111111-1111-4111-8111-111111111111"),
      email: "user@example.com",
      handle: "user",
      username: "User",
      sid: asSessionId("22222222-2222-4222-8222-222222222222"),
      isAdmin: false,
    };
    const unverifiedMiddleware = new AuthenticationMiddleware(
      {
        authenticate: sinon.stub().resolves(decodedUser),
      } as unknown as AuthStrategy,
      {
        findByPublicId: sinon.stub().resolves({
          isAdmin: false,
          isBanned: false,
          isEmailVerified: false,
        }),
      } as unknown as UserIdentityLookup,
      null,
    );
    const bannedMiddleware = new AuthenticationMiddleware(
      {
        authenticate: sinon.stub().resolves(decodedUser),
      } as unknown as AuthStrategy,
      {
        findByPublicId: sinon.stub().resolves({
          isAdmin: false,
          isBanned: true,
          isEmailVerified: true,
        }),
      } as unknown as UserIdentityLookup,
      null,
    );

    const unverifiedRequest = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: { authorization: "Bearer valid-token" },
    } as Request;
    const unverifiedNext = sinon.stub();
    await unverifiedMiddleware.handleOptional()(
      unverifiedRequest,
      {} as Response,
      unverifiedNext,
    );

    expect(unverifiedNext.calledOnceWithExactly()).to.equal(true);
    expect(unverifiedRequest.decodedUser).to.equal(undefined);
    expect(unverifiedRequest.authSource).to.equal(undefined);

    const bannedRequest = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: { authorization: "Bearer valid-token" },
    } as Request;
    const bannedNext = sinon.stub();
    await bannedMiddleware.handleOptional()(
      bannedRequest,
      {} as Response,
      bannedNext,
    );

    expect(bannedNext.calledOnce).to.equal(true);
    expect(bannedNext.firstCall.args[0]).to.include({
      name: "ForbiddenError",
      statusCode: 403,
      errorCode: ErrorCode.FORBIDDEN,
    });
  });

  it("propagates an optional Redis/session failure unchanged without a local terminal log", async () => {
    const secret = "test-secret";
    const cause = new Error("Redis unavailable");
    const strategy = new BearerTokenStrategy(secret, {
      assertAccessSession: sinon.stub().rejects(cause),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const token = jwt.sign(
      {
        publicId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        username: "User",
        handle: "user",
        sid: "22222222-2222-4222-8222-222222222222",
      },
      secret,
      { expiresIn: "5m" },
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: { authorization: `Bearer ${token}` },
    } as Request;
    const next = sinon.stub();
    const logError = sinon.stub(errorLogger, "error");
    const loggerError = sinon.stub(logger, "error");
    const warn = sinon.stub(logger, "warn");

    try {
      await middleware.handleOptional()(request, {} as Response, next);

      expect(next.calledOnceWithExactly(cause)).to.equal(true);
      sinon.assert.notCalled(logError);
      sinon.assert.notCalled(loggerError);
      sinon.assert.notCalled(warn);
    } finally {
      warn.restore();
      loggerError.restore();
      logError.restore();
    }
  });

  it("propagates optional repository and programming failures unchanged", async () => {
    const decodedUser: DecodedUser = {
      publicId: asUserPublicId("11111111-1111-4111-8111-111111111111"),
      email: "user@example.com",
      handle: "user",
      username: "User",
      sid: asSessionId("22222222-2222-4222-8222-222222222222"),
      isAdmin: false,
    };
    const repositoryFailure = new Error("Database unavailable");
    const repositoryMiddleware = new AuthenticationMiddleware(
      {
        authenticate: sinon.stub().resolves(decodedUser),
      } as unknown as AuthStrategy,
      {
        findByPublicId: sinon.stub().rejects(repositoryFailure),
      } as unknown as UserIdentityLookup,
      null,
    );
    const programmingFailure = new TypeError("Unexpected state");
    const programmingMiddleware = new AuthenticationMiddleware(
      {
        authenticate: sinon.stub().rejects(programmingFailure),
      } as unknown as AuthStrategy,
      {} as UserIdentityLookup,
      null,
    );

    for (const [middleware, expectedError] of [
      [repositoryMiddleware, repositoryFailure],
      [programmingMiddleware, programmingFailure],
    ] as const) {
      const request = {
        method: "GET",
        originalUrl: "/api/posts",
        baseUrl: "/api",
        path: "/posts",
        headers: { authorization: "Bearer valid-token" },
      } as Request;
      const next = sinon.stub();

      await middleware.handleOptional()(request, {} as Response, next);

      expect(next.calledOnceWithExactly(expectedError)).to.equal(true);
    }
  });

  it("forwards session infrastructure failures unchanged to one HTTP 5xx terminal record", async () => {
    const secret = "test-secret";
    const cause = new Error("Redis unavailable");
    const strategy = new BearerTokenStrategy(secret, {
      assertAccessSession: sinon.stub().rejects(cause),
    } as never);
    const middleware = new AuthenticationMiddleware(
      strategy,
      {} as UserIdentityLookup,
      null,
    );
    const token = jwt.sign(
      {
        publicId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
        username: "User",
        handle: "user",
        sid: "22222222-2222-4222-8222-222222222222",
      },
      secret,
      { expiresIn: "5m" },
    );
    const request = {
      method: "GET",
      originalUrl: "/api/posts",
      baseUrl: "/api",
      path: "/posts",
      headers: { authorization: `Bearer ${token}` },
    } as Request;
    const next = sinon.stub();

    await middleware.handle()(request, {} as Response, next);

    expect(next.calledOnceWithExactly(cause)).to.equal(true);

    const logError = sinon.stub(errorLogger, "error");
    const status = sinon.stub().returnsThis();
    const response = {
      setHeader: sinon.stub(),
      status,
      json: sinon.stub(),
    } as unknown as Response;

    try {
      const errorHandlerNext = sinon.stub() as unknown as NextFunction;

      ErrorHandler.handleError(cause, request, response, errorHandlerNext);

      expect(status.calledOnceWithExactly(500)).to.equal(true);
      sinon.assert.calledOnce(logError);
      expect(logError.firstCall.args[0]).to.have.nested.property(
        "error.cause.message",
        "Redis unavailable",
      );
    } finally {
      logError.restore();
    }
  });
});
