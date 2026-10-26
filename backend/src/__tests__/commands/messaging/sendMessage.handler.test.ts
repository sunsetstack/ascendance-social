import "reflect-metadata";
import { afterEach, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { ClientSession } from "mongoose";
import { SendMessageCommandHandler } from "@/application/commands/messaging/sendMessage/sendMessage.handler";
import { SendMessageCommand } from "@/application/commands/messaging/sendMessage/sendMessage.command";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { EventBus } from "@/application/common/buses/event.bus";
import { UnitOfWork, requireTransactionSession } from "@/database/UnitOfWork";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import Conversation from "@/models/conversation.model";
import Message from "@/models/message.model";
import User from "@/models/user.model";
import type { IMessage } from "@/types";
import { DTOService } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { resolveParticipantPublicIds } from "@/application/messaging/messaging-support";
import {
  asConversationPublicId,
  asMessagePublicId,
  asMongoId,
  asUserPublicId,
} from "@/types/branded";

describe("SendMessageCommandHandler transaction retries", () => {
  const senderId = asMongoId("507f1f77bcf86cd799439011");
  const recipientId = asMongoId("507f1f77bcf86cd799439012");
  const senderPublicId = asUserPublicId("11111111-1111-4111-8111-111111111111");
  const recipientPublicId = asUserPublicId("22222222-2222-4222-8222-222222222222");
  const participantIds = [senderId, recipientId].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const conversations = [
    new Conversation({
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439021"),
      publicId: asConversationPublicId("33333333-3333-4333-8333-333333333333"),
      participantHash: `${senderId}:${recipientId}`,
      participants: participantIds,
    }),
    new Conversation({
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439022"),
      publicId: asConversationPublicId("44444444-4444-4444-8444-444444444444"),
      participantHash: `${senderId}:${recipientId}`,
      participants: participantIds,
    }),
  ];
  const sender = new User({
    _id: participantIds[0],
    publicId: senderPublicId,
    handle: "sender",
    username: "Sender",
    avatar: "",
    email: "sender@example.test",
    password: "unused-test-password-hash",
  });
  const command = new SendMessageCommand(senderPublicId, {
    recipientPublicId,
    body: "Hello",
  });

  let client: mongoose.mongo.MongoClient;
  let session: ClientSession;
  let previousReadyState: number;
  let commit: sinon.SinonStub;
  let abort: sinon.SinonSpy;
  let conversationRepository: sinon.SinonStubbedInstance<ConversationRepository>;
  let messageRepository: sinon.SinonStubbedInstance<MessageRepository>;
  let eventBus: sinon.SinonStubbedInstance<EventBus>;
  let userReadRepository: {
    findInternalIdByPublicId: sinon.SinonStub;
    findById: sinon.SinonStub;
  };
  let messages: IMessage[];
  let handler: SendMessageCommandHandler;

  beforeEach(() => {
    client = new mongoose.mongo.MongoClient("mongodb://127.0.0.1:27017");
    session = client.startSession();
    const originalCommit = session.commitTransaction.bind(session);
    commit = sinon.stub(session, "commitTransaction").callsFake(originalCommit);
    abort = sinon.spy(session, "abortTransaction");
    sinon.stub(mongoose, "startSession").resolves(session);
    previousReadyState = mongoose.connection.readyState;
    (mongoose.connection as unknown as { readyState: number }).readyState = 1;

    conversationRepository = sinon.createStubInstance(ConversationRepository);
    conversationRepository.findByParticipantHash.resolves(null);
    conversationRepository.create.onFirstCall().resolves(conversations[0]);
    conversationRepository.create.onSecondCall().resolves(conversations[1]);
    conversationRepository.findOneAndUpdate.resolves(null);
    conversationRepository.resetUnreadCount.resolves();

    messages = conversations.map((conversation, index) => {
      const message = new Message({
        _id: new mongoose.Types.ObjectId(),
        publicId: asMessagePublicId(
          index === 0
            ? "55555555-5555-4555-8555-555555555555"
            : "66666666-6666-4666-8666-666666666666",
        ),
        conversation: conversation._id,
        sender,
        body: "Hello",
        status: "sent",
        readBy: [participantIds[0]],
        createdAt: new Date("2026-10-18T10:00:00.000Z"),
        updatedAt: new Date("2026-10-18T10:00:00.000Z"),
      });
      sinon.stub(message, "populate").resolves(message);
      return message;
    });
    messageRepository = sinon.createStubInstance(MessageRepository);
    messageRepository.create.onFirstCall().resolves(messages[0]);
    messageRepository.create.onSecondCall().resolves(messages[1]);
    messageRepository.markConversationMessagesAsRead.resolves();

    userReadRepository = {
      findInternalIdByPublicId: sinon.stub(),
      findById: sinon.stub(),
    };
    userReadRepository.findInternalIdByPublicId
      .withArgs(senderPublicId).resolves(senderId);
    userReadRepository.findInternalIdByPublicId
      .withArgs(recipientPublicId).resolves(recipientId);
    userReadRepository.findById.withArgs(senderId).resolves(sender);
    userReadRepository.findById.withArgs(recipientId).resolves({
      _id: participantIds[1],
      publicId: recipientPublicId,
    });

    eventBus = sinon.createStubInstance(EventBus);
    eventBus.queueTransactional.callsFake(async () => {
      expect(requireTransactionSession()).to.equal(session);
    });
    handler = new SendMessageCommandHandler(
      conversationRepository,
      messageRepository,
      userReadRepository as unknown as IUserReadRepository,
      new UnitOfWork(),
      new DTOService(),
      eventBus,
    );
  });

  afterEach(async () => {
    sinon.restore();
    await client.close();
    (mongoose.connection as unknown as { readyState: number }).readyState =
      previousReadyState;
  });

  it("returns the new conversation and message when the first commit succeeds", async () => {
    const result = await handler.execute(command);

    expect(result).to.include({
      publicId: messages[0].publicId,
      conversationId: conversations[0].publicId,
      body: "Hello",
      status: "sent",
    });
    expect(result.sender.publicId).to.equal(senderPublicId);
    expect(conversationRepository.create.calledOnce).to.be.true;
    expect(messageRepository.create.calledOnce).to.be.true;
    expect(eventBus.queueTransactional.calledOnce).to.be.true;
    expect(commit.calledOnce).to.be.true;
    expect(abort.called).to.be.false;
  });

  it("recreates the conversation after a transient commit failure and returns the retried pair", async () => {
    const startedAt = Date.now();
    const error = new mongoose.mongo.MongoServerError({
      message: "Injected transient commit failure",
      code: 251,
    });
    error.addErrorLabel("TransientTransactionError");
    commit.onFirstCall().rejects(error);

    const result = await handler.execute(command);

    expect(conversationRepository.create.calledTwice).to.be.true;
    expect(conversationRepository.findByParticipantHash.args).to.deep.equal([
      [`${senderId}:${recipientId}`],
      [`${senderId}:${recipientId}`],
    ]);
    expect(messageRepository.create.calledTwice).to.be.true;
    expect(conversationRepository.findOneAndUpdate.calledTwice).to.be.true;
    expect(eventBus.queueTransactional.calledTwice).to.be.true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { createdAt, ...storedMessage } = messageRepository.create.getCall(attempt).args[0];
      expect(storedMessage).to.deep.equal({
        conversation: conversations[attempt]._id,
        sender: participantIds[0],
        body: "Hello",
        readBy: [participantIds[0]],
        status: "sent",
      });
      expect(createdAt).to.be.instanceOf(Date);
      expect(createdAt!.getTime()).to.be.at.least(startedAt);
      expect(conversationRepository.findOneAndUpdate.getCall(attempt).args[0])
        .to.deep.equal({ _id: conversations[attempt]._id });
      const event = eventBus.queueTransactional.getCall(attempt).args[0];
      expect(event).to.be.instanceOf(MessageSentEvent);
      expect(event).to.include({
        conversationPublicId: conversations[attempt].publicId,
        messagePublicId: messages[attempt].publicId,
        senderPublicId,
      });
      expect((event as MessageSentEvent).recipientPublicIds)
        .to.deep.equal([recipientPublicId]);
    }
    expect(result).to.include({
      publicId: messages[1].publicId,
      conversationId: conversations[1].publicId,
    });
    expect(messageRepository.markConversationMessagesAsRead.called).to.be.false;
    expect(conversationRepository.resetUnreadCount.called).to.be.false;
    expect(commit.calledTwice).to.be.true;
    expect(abort.calledOnce).to.be.true;
  });

  it("aborts after a participant lookup fails following the message and conversation writes", async () => {
    const failure = Errors.database("Participant lookup unavailable");
    userReadRepository.findById.withArgs(recipientId).callsFake(async () => {
      expect(requireTransactionSession()).to.equal(session);
      expect(messageRepository.create.calledOnce).to.be.true;
      expect(conversationRepository.findOneAndUpdate.calledOnce).to.be.true;
      throw failure;
    });

    const error = await handler.execute(command).catch((reason: unknown) => reason);

    expect(error).to.equal(failure);
    expect(userReadRepository.findById.args).to.deep.equal([[senderId], [recipientId]]);
    expect(abort.calledOnce).to.be.true;
    expect(commit.called).to.be.false;
    expect(eventBus.queueTransactional.called).to.be.false;
  });

  it("awaits each participant lookup and skips only missing users", async () => {
    let releaseFirst!: () => void;
    userReadRepository.findById.withArgs(senderId).callsFake(async () => {
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return sender;
    });
    userReadRepository.findById.withArgs(recipientId).resolves(null);
    const ids = resolveParticipantPublicIds(
      userReadRepository as unknown as IUserReadRepository,
      [senderId, recipientId],
    );

    const awaitingFirstLookup = userReadRepository.findById.calledOnceWithExactly(senderId);
    releaseFirst();

    expect(awaitingFirstLookup).to.be.true;
    expect(await ids).to.deep.equal([senderPublicId]);
    expect(userReadRepository.findById.args).to.deep.equal([[senderId], [recipientId]]);
  });
});
