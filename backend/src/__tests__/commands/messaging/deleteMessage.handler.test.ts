import "reflect-metadata";
import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
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
  let eventBus: { queueTransactional: sinon.SinonStub };
  let handler: DeleteMessageCommandHandler;

  beforeEach(() => {
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
    eventBus = {
      queueTransactional: sinon.stub().resolves(),
    };

    handler = new DeleteMessageCommandHandler(
      messageRepository as any,
      userRepository as any,
      unitOfWork as any,
      eventBus as any,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("allows deletion when the populated sender only exposes the matching publicId", async () => {
    messageRepository.findByPublicId.resolves({
      publicId: messagePublicId,
      sender: { publicId: userPublicId },
      attachments: [],
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
    expect(eventBus.queueTransactional.called).to.be.false;
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
