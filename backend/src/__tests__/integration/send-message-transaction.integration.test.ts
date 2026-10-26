import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import mongoose from "mongoose";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { SendMessageCommand } from "@/application/commands/messaging/sendMessage/sendMessage.command";
import { SendMessageCommandHandler } from "@/application/commands/messaging/sendMessage/sendMessage.handler";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { requireTransactionSession, UnitOfWork } from "@/database/UnitOfWork";
import Conversation from "@/models/conversation.model";
import Follow from "@/models/follow.model";
import Message from "@/models/message.model";
import { OutboxModel } from "@/models/outbox.model";
import User from "@/models/user.model";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { DTOService } from "@/services/dto.service";
import { MetricsService } from "@/metrics/metrics.service";
import { asConversationPublicId, asUserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { buildParticipantHash } from "@/utils/messaging-helpers";

describe("SendMessage transactional participant resolution integration", function () {
  this.timeout(30_000);

  const senderId = new mongoose.Types.ObjectId();
  const recipientId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  const previousMessageId = new mongoose.Types.ObjectId();
  const senderPublicId = asUserPublicId(randomUUID());
  const recipientPublicId = asUserPublicId(randomUUID());
  const conversationPublicId = asConversationPublicId(randomUUID());
  const outboxFilter = { "payload.conversationPublicId": conversationPublicId };
  const command = new SendMessageCommand(senderPublicId, {
    conversationPublicId,
    body: "New message",
  });
  let connectedHere = false;
  let users: UserReadRepository;
  let handler: SendMessageCommandHandler;

  before(async () => {
    const uri = process.env.INTEGRATION_MONGODB_URI;
    if (!uri || !uri.includes("127.0.0.1") || !uri.includes("ascendance_integration")) {
      throw new Error("Send-message integration requires the isolated local ascendance_integration replica set");
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
      connectedHere = true;
    }
    if (!mongoose.connection.name.startsWith("ascendance_integration")) {
      throw new Error("Send-message integration must use an isolated integration database");
    }
    await Promise.all([User.init(), Conversation.init(), Message.init(), OutboxModel.init()]);
  });

  beforeEach(async () => {
    await User.collection.insertMany([
      {
        _id: senderId, publicId: senderPublicId, handle: senderPublicId,
        handleNormalized: senderPublicId, username: senderPublicId,
        email: `${senderPublicId}@example.test`, password: "unused-test-password-hash", authVersion: 0, avatar: "",
      },
      {
        _id: recipientId, publicId: recipientPublicId, handle: recipientPublicId,
        handleNormalized: recipientPublicId, username: recipientPublicId,
        email: `${recipientPublicId}@example.test`, password: "unused-test-password-hash", authVersion: 0, avatar: "",
      },
    ]);
    await Message.create({
      _id: previousMessageId,
      conversation: conversationId,
      sender: recipientId,
      body: "Earlier message",
      readBy: [recipientId],
      status: "sent",
    });
    await Conversation.create({
      _id: conversationId,
      publicId: conversationPublicId,
      participantHash: buildParticipantHash([String(senderId), String(recipientId)]),
      participants: [senderId, recipientId],
      lastMessage: previousMessageId,
      lastMessageAt: new Date("2026-10-18T10:00:00.000Z"),
      unreadCounts: new Map([[String(senderId), 1], [String(recipientId), 0]]),
    });
    users = new UserReadRepository(User, new FollowRepository(Follow));
    handler = new SendMessageCommandHandler(
      new ConversationRepository(Conversation),
      new MessageRepository(Message),
      users,
      new UnitOfWork(),
      new DTOService(),
      new EventBus(new OutboxRepository(OutboxModel), new MetricsService()),
    );
  });

  afterEach(async () => {
    sinon.restore();
    await Message.deleteMany({ conversation: conversationId });
    await Conversation.deleteOne({ _id: conversationId });
    await User.deleteMany({ _id: { $in: [senderId, recipientId] } });
    await OutboxModel.deleteMany(outboxFilter);
  });

  after(async () => {
    if (connectedHere) await mongoose.disconnect();
  });

  async function durableState() {
    return {
      conversation: await Conversation.findById(conversationId).lean().exec(),
      messages: await Message.find({ conversation: conversationId }).sort({ _id: 1 }).lean().exec(),
      outbox: await OutboxModel.find(outboxFilter).lean().exec(),
    };
  }

  it("commits the message, unread changes, and complete recipient event on success", async () => {
    const result = await handler.execute(command);
    const state = await durableState();

    expect(result).to.include({ conversationId: conversationPublicId, body: "New message" });
    expect(result.sender.publicId).to.equal(senderPublicId);
    expect(state.messages).to.have.length(2);
    const sent = state.messages.find((message) => message.publicId === result.publicId)!;
    expect(String(state.conversation!.lastMessage)).to.equal(String(sent._id));
    expect(state.conversation!.unreadCounts).to.deep.equal({ [String(senderId)]: 0, [String(recipientId)]: 1 });
    const previous = state.messages.find((message) => String(message._id) === String(previousMessageId))!;
    expect(previous.readBy.map(String)).to.have.members([String(recipientId), String(senderId)]);
    expect(previous.status).to.equal("read");
    expect(state.outbox).to.have.length(1);
    expect(state.outbox[0]).to.include({ eventType: MessageSentEvent.type, processed: false });
    expect(state.outbox[0].payload).to.include({
      conversationPublicId,
      messagePublicId: result.publicId,
      senderPublicId,
    });
    expect(state.outbox[0].payload.recipientPublicIds).to.deep.equal([recipientPublicId]);
  });

  it("rolls back prior writes and commits no outbox event when a participant lookup fails", async () => {
    const before = await durableState();
    const failure = Errors.database("Injected participant lookup failure");
    const findById = users.findById.bind(users);
    const lookup = sinon.stub(users, "findById").callsFake(async (id, options) => {
      if (String(id) !== String(recipientId)) return findById(id, options);
      const session = requireTransactionSession();
      const stagedMessages = await Message.find({ conversation: conversationId }).session(session).lean().exec();
      const stagedConversation = await Conversation.findById(conversationId).session(session).lean().exec();
      expect(stagedMessages).to.have.length(2);
      expect(String(stagedConversation!.lastMessage)).not.to.equal(String(previousMessageId));
      expect(stagedConversation!.unreadCounts).to.deep.equal({ [String(senderId)]: 0, [String(recipientId)]: 1 });
      throw failure;
    });

    const error = await handler.execute(command).catch((reason: unknown) => reason);

    expect(error).to.equal(failure);
    expect(lookup.args.map(([id]) => String(id))).to.deep.equal([String(senderId), String(recipientId)]);
    expect(await durableState()).to.deep.equal(before);
    expect(before.outbox).to.have.length(0);
  });
});
