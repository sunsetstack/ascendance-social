import { expect } from "chai";
import sinon from "sinon";
import { csrfOriginMiddleware } from "@/middleware/csrf-origin.middleware";
import { authCookieNames } from "@/config/cookieConfig";

describe("csrfOriginMiddleware", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it("allows unsafe cookie-auth requests from an allowed origin", () => {
    const req = {
      method: "POST",
      originalUrl: "/api/users/follow/user-id",
      cookies: { [authCookieNames.accessToken]: "token" },
      get: sinon.stub().withArgs("origin").returns("https://app.example.com"),
    } as any;
    const next = sinon.stub();

    csrfOriginMiddleware(req, {} as any, next);

    expect(next.calledOnceWithExactly()).to.be.true;
  });

  it("blocks unsafe cookie-auth requests without an allowed origin", () => {
    const req = {
      method: "POST",
      originalUrl: "/api/users/follow/user-id",
      cookies: { [authCookieNames.accessToken]: "token" },
      get: sinon.stub().returns(undefined),
    } as any;
    const next = sinon.stub();

    csrfOriginMiddleware(req, {} as any, next);

    expect(next.calledOnce).to.be.true;
    expect(next.firstCall.args[0]).to.include({ statusCode: 403 });
  });
});
