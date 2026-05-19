import "reflect-metadata";
import { describe, beforeEach, afterEach, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose from "mongoose";
import { GetConversationMessagesQueryHandler } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.handler";
import { GetConversationMessagesQuery } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.query";
import {
  asConversationPublicId,
  asUserPublicId,
} from "@/types/branded";

describe("GetConversationMessagesQueryHandler", () => {
  const viewerPublicId = asUserPublicId(
    "f1e2d3c4-b5a6-4978-8d9e-0f1a2b3c4d5e",
  );
  const conversationPublicId = asConversationPublicId(
    "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  );
  const viewerInternalId = "507f1f77bcf86cd799439011";
  const otherInternalId = new mongoose.Types.ObjectId();

  let conversationRepository: { findByPublicId: sinon.SinonStub };
  let messageRepository: {
    markConversationMessagesAsDelivered: sinon.SinonStub;
    findMessagesByConversation: sinon.SinonStub;
  };
  let userRepository: { findInternalIdByPublicId: sinon.SinonStub };
  let unitOfWork: { executeInTransaction: sinon.SinonStub };
  let dtoService: { toPublicMessageDTO: sinon.SinonStub };
  let eventBus: { queueTransactional: sinon.SinonStub };
  let handler: GetConversationMessagesQueryHandler;

  beforeEach(() => {
    conversationRepository = {
      findByPublicId: sinon.stub(),
    };
    messageRepository = {
      markConversationMessagesAsDelivered: sinon.stub().resolves(false),
      findMessagesByConversation: sinon.stub(),
    };
    userRepository = {
      findInternalIdByPublicId: sinon.stub().resolves(viewerInternalId),
    };
    unitOfWork = {
      executeInTransaction: sinon
        .stub()
        .callsFake(async (work: () => Promise<void>) => await work()),
    };
    dtoService = {
      toPublicMessageDTO: sinon.stub(),
    };
    eventBus = {
      queueTransactional: sinon.stub().resolves(),
    };

    handler = new GetConversationMessagesQueryHandler(
      conversationRepository as any,
      messageRepository as any,
      userRepository as any,
      unitOfWork as any,
      dtoService as any,
      eventBus as any,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("throws ForbiddenError when the viewer is not a conversation participant", async () => {
    conversationRepository.findByPublicId.resolves({
      _id: new mongoose.Types.ObjectId(),
      publicId: conversationPublicId,
      participants: [otherInternalId],
      unreadCounts: new Map<string, number>(),
      isGroup: false,
      updatedAt: new Date(),
    });

    try {
      await handler.execute(
        new GetConversationMessagesQuery(
          viewerPublicId,
          conversationPublicId,
          1,
          30,
        ),
      );
      expect.fail("Expected execute() to throw");
    } catch (error: any) {
      expect(error.name).to.equal("ForbiddenError");
      expect(error.message).to.equal(
        "You do not have access to this conversation",
      );
    }

    expect(messageRepository.findMessagesByConversation.called).to.be.false;
  });
});
