import { describe, it } from "mocha";
import { expect } from "chai";
import express, { RequestHandler } from "express";
import request from "supertest";
import sinon from "sinon";
import { PostRoutes } from "@/routes/post.routes";

describe("PostRoutes", () => {
  function buildApp() {
    const authRequired: RequestHandler = sinon
      .stub()
      .callsFake((_req, res, _next) => {
        res.status(401).json({ error: "auth required" });
      });

    const optionalAuth: RequestHandler = sinon
      .stub()
      .callsFake((_req, _res, next) => {
        next();
      });

    const controller = {
      listPosts: sinon.stub(),
      getPostBySlug: sinon.stub(),
      getPostByPublicId: sinon.stub(),
      getPostsByHandle: sinon.stub(),
      getPostsByUserPublicId: sinon.stub(),
      getLikedPostsByUserPublicId: sinon.stub(),
      searchByTags: sinon.stub(),
      listTags: sinon.stub(),
      createPost: sinon.stub(),
      repostPost: sinon.stub(),
      unrepostPost: sinon.stub(),
      deletePost: sinon.stub(),
    };

    const authMiddlewareService = {
      required: () => authRequired,
      optional: () => optionalAuth,
    };

    const routes = new PostRoutes(
      controller as any,
      authMiddlewareService as any,
    );

    const app = express();
    app.use("/api/posts", routes.getRouter());
    app.get("/api/posts/:postPublicId/comments", (_req, res) => {
      res.status(200).json({ comments: [] });
    });

    return { app, authRequired };
  }

  it("allows anonymous comment reads to reach the comments router", async () => {
    const { app, authRequired } = buildApp();

    const response = await request(app)
      .get("/api/posts/post-123/comments")
      .expect(200);

    expect(response.body).to.deep.equal({ comments: [] });
    expect((authRequired as sinon.SinonStub).called).to.equal(false);
  });

  it("keeps every post mutation behind required authentication", async () => {
    const { app, authRequired } = buildApp();

    await request(app).post("/api/posts").expect(401);
    await request(app).post("/api/posts/post-123/repost").expect(401);
    await request(app).delete("/api/posts/post-123/repost").expect(401);
    await request(app).delete("/api/posts/post-123").expect(401);

    expect((authRequired as sinon.SinonStub).callCount).to.equal(4);
  });
});
