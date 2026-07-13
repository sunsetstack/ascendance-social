import { expect } from "chai";
import express, { RequestHandler } from "express";
import { describe, it } from "mocha";
import request from "supertest";
import sinon from "sinon";
import { UserRoutes } from "@/routes/user.routes";

describe("UserRoutes", () => {
  function buildApp() {
    const regularAuth: RequestHandler = sinon
      .stub()
      .callsFake((_req, res, _next) => {
        res.status(401).json({ error: "verified auth required" });
      });
    const unverifiedAuth: RequestHandler = sinon
      .stub()
      .callsFake((_req, _res, next) => next());
    const optionalAuth: RequestHandler = sinon
      .stub()
      .callsFake((_req, _res, next) => next());

    const authController = {
      register: sinon.stub(),
      login: sinon.stub(),
      logout: sinon.stub(),
      refresh: sinon.stub(),
      requestPasswordReset: sinon.stub(),
      resetPassword: sinon.stub(),
      verifyEmail: sinon.stub(),
    };
    const profileController = {
      getMe: sinon.stub(),
      getAccountInfo: sinon.stub(),
      updateProfile: sinon.stub(),
      updateAvatar: sinon.stub(),
      updateCover: sinon.stub(),
      changePassword: sinon.stub(),
      deleteMyAccount: sinon.stub().callsFake((_req, res) => {
        res.status(200).json({ message: "Account deleted successfully" });
      }),
    };
    const socialController = {
      getHandleSuggestions: sinon.stub(),
      getFollowers: sinon.stub(),
      getFollowing: sinon.stub(),
      getWhoToFollow: sinon.stub(),
      followUserByPublicId: sinon.stub(),
      unfollowUserByPublicId: sinon.stub(),
      checkFollowStatus: sinon.stub(),
      likeActionByPublicId: sinon.stub(),
    };
    const userQueryController = {
      getUsers: sinon.stub(),
      getUserByHandle: sinon.stub(),
      getUserByPublicId: sinon.stub(),
    };
    const authMiddlewareService = {
      required: sinon.stub().callsFake((options) =>
        options?.allowUnverified ? unverifiedAuth : regularAuth,
      ),
      optional: sinon.stub().returns(optionalAuth),
    };

    const routes = new UserRoutes(
      authController as any,
      profileController as any,
      socialController as any,
      userQueryController as any,
      authMiddlewareService as any,
    );
    const app = express();
    app.use(express.json());
    app.use("/api/users", routes.getRouter());

    return { app, regularAuth, unverifiedAuth };
  }

  it("routes account deletion through authenticated unverified access", async () => {
    const { app, regularAuth, unverifiedAuth } = buildApp();

    const response = await request(app).delete("/api/users/me").send({
      password: "password123",
      reason: "No longer using this account",
    });

    expect(response.status).to.equal(200);
    expect((unverifiedAuth as sinon.SinonStub).calledOnce).to.equal(true);
    expect((regularAuth as sinon.SinonStub).called).to.equal(false);
  });

  it("keeps ordinary account routes behind verified authentication", async () => {
    const { app, regularAuth, unverifiedAuth } = buildApp();

    await request(app).get("/api/users/me").expect(401);

    expect((regularAuth as sinon.SinonStub).calledOnce).to.equal(true);
    expect((unverifiedAuth as sinon.SinonStub).called).to.equal(false);
  });
});
