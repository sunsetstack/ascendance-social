import "reflect-metadata";
import { expect } from "chai";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { describe, it } from "mocha";
import request from "supertest";
import sinon from "sinon";
import { MessagingRoutes } from "@/routes/messaging.routes";

describe("MessagingRoutes", () => {
  it("rejects multipart message attachments before the controller runs", async () => {
    const sendMessage = sinon.stub();
    const controller = {
      deleteConversation: sinon.stub(),
      purgeConversation: sinon.stub(),
      lockConversation: sinon.stub(),
      unlockConversation: sinon.stub(),
      deleteMessage: sinon.stub(),
      editMessage: sinon.stub(),
      getConversationMessages: sinon.stub(),
      initiateConversation: sinon.stub(),
      listConversations: sinon.stub(),
      markConversationRead: sinon.stub(),
      sendMessage,
    };
    const allowAuth: RequestHandler = (_req, _res, next) => next();
    const routes = new MessagingRoutes(controller as any, {
      required: sinon.stub().returns(allowAuth),
      adminOnly: sinon.stub().returns(allowAuth),
    } as any);
    const app = express();
    app.use("/api/messaging", routes.getRouter());
    const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(error.statusCode ?? 400).json({ message: error.message });
    };
    app.use(errorHandler);

    const response = await request(app)
      .post("/api/messaging/messages")
      .field("recipientPublicId", "11111111-1111-4111-8111-111111111111")
      .field("body", "hello")
      .attach("attachment", Buffer.from("unsafe"), "unsafe.txt");

    expect(response.status).to.equal(400);
    expect(response.body.message).to.equal(
      "Message attachments are not supported",
    );
    expect(sendMessage.called).to.equal(false);
  });
});
