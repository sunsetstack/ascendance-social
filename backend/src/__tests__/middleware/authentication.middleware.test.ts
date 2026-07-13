import { expect } from "chai";
import { describe, it } from "mocha";
import { Request, Response } from "express";
import sinon from "sinon";
import {
  AuthenticationMiddleware,
  AuthStrategy,
} from "@/middleware/authentication.middleware";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { asSessionId, asUserPublicId } from "@/types/branded";
import type { DecodedUser } from "@/types";

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
    } as unknown as IUserReadRepository;
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
    const { decodedUser, middleware, request, next } =
      buildUnverifiedRequest();

    await middleware.handle({ allowUnverified: true })(
      request,
      {} as Response,
      next,
    );

    expect(next.calledOnceWithExactly()).to.equal(true);
    expect(request.decodedUser).to.equal(decodedUser);
    expect(request.decodedUser?.isEmailVerified).to.equal(false);
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
});
