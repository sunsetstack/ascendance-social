import "reflect-metadata";
import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import { DeleteMessageCommandHandler } from "@/application/commands/messaging/deleteMessage/deleteMessage.handler";
import { DeleteMessageCommand } from "@/application/commands/messaging/deleteMessage/deleteMessage.command";
import { asMessagePublicId, asUserPublicId } from "@/types/branded";

describe("DeleteMessageCommandHandler", () => {
  const userPublicId = asUserPublicId("f1e2d3c4-b5a6-4978-8d9e-0f1a2b3c4d5e");
  const messagePublicId = asMessagePublicId(
    "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  );
  const userInternalId = "507f1f77bcf86cd799439011";

  let userRepository: { findInternalIdByPublicId: sinon.SinonStub };
  let messageRepository: {
    findByPublicId: sinon.SinonStub;
    updateMessage: sinon.SinonStub;
  };
  let unitOfWork: { executeInTransaction: sinon.SinonStub };
  let conversationRepository: { findById: sinon.SinonStub; acquireForMutation: sinon.SinonStub };
  let handler: DeleteMessageCommandHandler;

  beforeEach(() => {
    const conversation = { publicId: "conversation", participants: [new mongoose.Types.ObjectId(userInternalId)] };
    conversationRepository = {
      findById: sinon.stub().resolves(conversation),
      acquireForMutation: sinon.stub().resolves(conversation),
    };
    userRepository = {
      findInternalIdByPublicId: sinon.stub().resolves(userInternalId),
    };
    messageRepository = {
      findByPublicId: sinon.stub(),
      updateMessage: sinon.stub().resolves(),
    };
    unitOfWork = {
      executeInTransaction: sinon
        .stub()
        .callsFake(async (work: () => Promise<void>) => await work()),
    };
    handler = new DeleteMessageCommandHandler(
      conversationRepository as any,
      messageRepository as any,
      userRepository as any,
      unitOfWork as any,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("tombstones legacy attachment messages without scheduling storage deletion", async () => {
    messageRepository.findByPublicId.resolves({
      publicId: messagePublicId,
      conversation: new mongoose.Types.ObjectId(),
      sender: { publicId: userPublicId },
      attachments: [
        {
          url: "https://attacker.example/untrusted-resource",
          publicId: "untrusted-public-id",
        },
      ],
      body: "hello",
      status: "sent",
      readBy: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await handler.execute(new DeleteMessageCommand(userPublicId, messagePublicId));

    expect(messageRepository.updateMessage.calledOnceWith(messagePublicId, {
      body: "message deleted by user",
      attachments: [],
    })).to.be.true;
  });

  it("throws NotFoundError when the message does not exist", async () => {
    messageRepository.findByPublicId.resolves(null);

    try {
      await handler.execute(
        new DeleteMessageCommand(userPublicId, messagePublicId),
      );
      expect.fail("Expected execute() to throw");
    } catch (error: any) {
      expect(error.name).to.equal("NotFoundError");
    }
  });
});
