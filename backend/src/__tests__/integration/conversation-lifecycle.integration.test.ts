import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect } from "chai";
import express, { type ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import sinon from "sinon";
import request from "supertest";
import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { EventBus } from "@/application/common/buses/event.bus";
import {
  ManageConversationCommand,
  type ConversationAction,
} from "@/application/commands/messaging/manageConversation/manageConversation.command";
import { ManageConversationCommandHandler } from "@/application/commands/messaging/manageConversation/manageConversation.handler";
import { SendMessageCommand } from "@/application/commands/messaging/sendMessage/sendMessage.command";
import { SendMessageCommandHandler } from "@/application/commands/messaging/sendMessage/sendMessage.handler";
import { DeleteMessageCommand } from "@/application/commands/messaging/deleteMessage/deleteMessage.command";
import { DeleteMessageCommandHandler } from "@/application/commands/messaging/deleteMessage/deleteMessage.handler";
import { EditMessageCommand } from "@/application/commands/messaging/editMessage/editMessage.command";
import { EditMessageCommandHandler } from "@/application/commands/messaging/editMessage/editMessage.handler";
import { InitiateConversationCommand } from "@/application/commands/messaging/initiateConversation/initiateConversation.command";
import { InitiateConversationCommandHandler } from "@/application/commands/messaging/initiateConversation/initiateConversation.handler";
import { MarkConversationReadCommand } from "@/application/commands/messaging/markConversationRead/markConversationRead.command";
import { MarkConversationReadCommandHandler } from "@/application/commands/messaging/markConversationRead/markConversationRead.handler";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { CreateNotificationCommandHandler } from "@/application/commands/notification/createNotification/createNotification.handler";
import { GetConversationMessagesQuery } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.query";
import { GetConversationMessagesQueryHandler } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.handler";
import { ListConversationsQuery } from "@/application/queries/messaging/listConversations/listConversations.query";
import { ListConversationsQueryHandler } from "@/application/queries/messaging/listConversations/listConversations.handler";
import { GetNotificationsQuery } from "@/application/queries/notification/getNotifications/getNotifications.query";
import { GetNotificationsQueryHandler } from "@/application/queries/notification/getNotifications/getNotifications.handler";
import {
  ConversationsChangedEvent,
  MessageSentEvent,
  MessageStatusUpdatedEvent,
} from "@/application/events/message/message.event";
import { ConversationsChangedHandler } from "@/application/events/message/conversations-changed.handler";
import { MessageSentHandler } from "@/application/events/message/message-sent.handler";
import { MessageStatusUpdatedHandler } from "@/application/events/message/message-status-updated.handler";
import { ConversationsChangedHandler as RealtimeConversationsChangedHandler } from "@/application/handlers/realtime/ConversationsChangedHandler";
import { MessagingController } from "@/controllers/messaging.controller";
import { UnitOfWork } from "@/database/UnitOfWork";
import { MetricsService } from "@/metrics/metrics.service";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import Conversation from "@/models/conversation.model";
import Message from "@/models/message.model";
import Notification from "@/models/notification.model";
import { OutboxModel } from "@/models/outbox.model";
import { RequestLogModel } from "@/models/requestLog.model";
import User from "@/models/user.model";
import Follow from "@/models/follow.model";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { NotificationRepository } from "@/repositories/notification.repository";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { FollowRepository } from "@/repositories/follow.repository";
import { MessagingRoutes } from "@/routes/messaging.routes";
import { DTOService } from "@/services/dto.service";
import { RedisService } from "@/services/redis.service";
import { RedisSessionModule } from "@/services/redis/redis-session.module";
import { AuthSessionService } from "@/services/auth-session.service";
import { RealTimeFeedService } from "@/services/feed/real-time-feed.service";
import { WebSocketServer } from "@/server/socketServer";
import { OutboxWorker } from "@/workers/outbox.worker";
import {
  asConversationPublicId,
  asUserPublicId,
  asSessionId,
} from "@/types/branded";
import { buildParticipantHash } from "@/utils/messaging-helpers";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";

class PollableOutboxWorker extends OutboxWorker {
  poll(): Promise<void> {
    return this.tick();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Conversation lifecycle with real MongoDB, Redis, HTTP and sockets", function () {
  this.timeout(30_000);
  const people = ["alice", "bob", "admin", "outsider"].map((handle, index) => ({
    _id: new mongoose.Types.ObjectId(),
    publicId: asUserPublicId(randomUUID()),
    handle,
    handleNormalized: handle,
    username: handle,
    email: `${handle}@example.test`,
    password: "unused-test-password-hash",
    avatar: "",
    authVersion: 1,
    isEmailVerified: true,
    isAdmin: index === 2,
    isBanned: false,
  }));
  const [alice, bob, admin, outsider] = people;
  const conversationId = new mongoose.Types.ObjectId();
  const conversationPublicId = asConversationPublicId(randomUUID());
  const oldMessageIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  const oldMessagePublicIds = [randomUUID(), randomUUID()];
  const lastMessageAt = new Date("2026-10-18T10:00:00.001Z");
  const originalEnv = new Map(
    ["JWT_SECRET", "ALLOWED_ORIGINS", "REDIS_AUTOCONNECT", "ADMIN_EMAILS"].map(
      (key) => [key, process.env[key]],
    ),
  );
  let metrics: MetricsService;
  let redis: RedisService;
  let conversations: ConversationRepository;
  let messages: MessageRepository;
  let notifications: NotificationRepository;
  let events: EventBus;
  let bus: CommandBus;
  let manage: ManageConversationCommandHandler;
  let send: SendMessageCommandHandler;
  let worker: PollableOutboxWorker;
  let app: express.Express;
  let users: UserReadRepository;
  let auth: AuthMiddlewareService;
  let sessions: AuthSessionService;
  let tokens: string[];
  let logs: RequestLogRepository;

  before(async () => {
    const uri = process.env.INTEGRATION_MONGODB_URI ?? "";
    const redisUrl = new URL(process.env.REDIS_URL ?? "redis://invalid");
    if (
      !uri.includes("127.0.0.1") ||
      !uri.includes("ascendance_integration") ||
      redisUrl.hostname !== "127.0.0.1" ||
      !redisUrl.port ||
      redisUrl.port === "6379"
    ) {
      throw new Error(
        "Conversation integration requires explicitly isolated local MongoDB and Redis ports",
      );
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    if (!mongoose.connection.name.startsWith("ascendance_integration"))
      throw new Error("Unsafe integration database");
    await Promise.all([
      User.init(),
      Conversation.init(),
      Message.init(),
      Notification.init(),
      OutboxModel.init(),
      RequestLogModel.init(),
    ]);
    process.env.JWT_SECRET = "conversation-integration-secret";
    process.env.ALLOWED_ORIGINS = "https://app.example.test";
    process.env.REDIS_AUTOCONNECT = "false";
    delete process.env.ADMIN_EMAILS;
    redis = new RedisService(new MetricsService());
    await redis.clientInstance.connect();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      Notification.deleteMany({}),
      OutboxModel.deleteMany({}),
      RequestLogModel.deleteMany({}),
    ]);
    await redis.clientInstance.flushDb();
    await User.collection.insertMany(people);
    await Message.collection.insertMany(
      oldMessageIds.map((_id, index) => ({
        _id,
        publicId: oldMessagePublicIds[index],
        conversation: conversationId,
        sender: people[index]._id,
        body: `Private history ${index}`,
        attachments: [],
        status: "sent",
        readBy: [people[index]._id],
        createdAt: new Date(lastMessageAt.getTime() - 1 + index),
        updatedAt: lastMessageAt,
      })),
    );
    await Conversation.create({
      _id: conversationId,
      publicId: conversationPublicId,
      participantHash: buildParticipantHash([
        String(alice._id),
        String(bob._id),
      ]),
      participants: [alice._id, bob._id],
      lastMessage: oldMessageIds[1],
      lastMessageAt,
      unreadCounts: new Map([
        [String(alice._id), 1],
        [String(bob._id), 1],
      ]),
    });
    metrics = new MetricsService();
    conversations = new ConversationRepository(Conversation);
    messages = new MessageRepository(Message);
    notifications = new NotificationRepository(Notification);
    logs = new RequestLogRepository();
    users = new UserReadRepository(User, new FollowRepository(Follow));
    const uow = new UnitOfWork();
    const dto = new DTOService();
    const outbox = new OutboxRepository(OutboxModel);
    events = new EventBus(outbox, metrics);
    bus = new CommandBus();
    const queries = new QueryBus();
    manage = new ManageConversationCommandHandler(
      conversations,
      users,
      uow,
      events,
      metrics,
    );
    send = new SendMessageCommandHandler(
      conversations,
      messages,
      users,
      uow,
      dto,
      events,
    );
    bus.register(ManageConversationCommand, manage);
    bus.register(SendMessageCommand, send);
    bus.register(
      DeleteMessageCommand,
      new DeleteMessageCommandHandler(conversations, messages, users, uow),
    );
    bus.register(
      EditMessageCommand,
      new EditMessageCommandHandler(conversations, messages, users, dto, uow),
    );
    bus.register(
      InitiateConversationCommand,
      new InitiateConversationCommandHandler(conversations, users, uow, dto),
    );
    bus.register(
      MarkConversationReadCommand,
      new MarkConversationReadCommandHandler(
        conversations,
        messages,
        users,
        uow,
        events,
      ),
    );
    bus.register(
      CreateNotificationCommand,
      new CreateNotificationCommandHandler(notifications, users, redis),
    );
    queries.register(
      ListConversationsQuery,
      new ListConversationsQueryHandler(conversations, users, dto),
    );
    queries.register(
      GetConversationMessagesQuery,
      new GetConversationMessagesQueryHandler(
        conversations,
        messages,
        users,
        uow,
        dto,
        events,
      ),
    );
    events.subscribe(
      ConversationsChangedEvent,
      new ConversationsChangedHandler(logs, redis, metrics),
    );
    events.subscribe(
      MessageSentEvent,
      new MessageSentHandler(conversations, messages, uow, redis, bus, users),
    );
    events.subscribe(
      MessageStatusUpdatedEvent,
      new MessageStatusUpdatedHandler(redis),
    );
    worker = new PollableOutboxWorker(outbox, events, metrics);
    sessions = new AuthSessionService(
      new RedisSessionModule(redis.clientInstance),
      users,
      redis,
    );
    auth = new AuthMiddlewareService(sessions, users, metrics);
    tokens = [];
    for (const user of people) {
      const sid = asSessionId(randomUUID());
      await sessions.createSession({
        sid,
        publicId: user.publicId,
        authVersion: 1,
        isEmailVerified: true,
        refreshToken: `${sid}.secret`,
        ttlSeconds: 300,
      });
      tokens.push(
        jwt.sign(
          {
            publicId: user.publicId,
            sid,
            email: user.email,
            handle: user.handle,
            username: user.username,
            isAdmin: user.isAdmin,
          },
          process.env.JWT_SECRET!,
          { expiresIn: 300 },
        ),
      );
    }
    app = express();
    app.use(express.json());
    app.use(
      "/api/messaging",
      new MessagingRoutes(
        new MessagingController(bus, queries),
        auth,
      ).getRouter(),
    );
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(error.statusCode ?? 500).json({ message: error.message });
    };
    app.use(errors);
  });

  afterEach(() => sinon.restore());
  after(async () => {
    if (redis) {
      await redis.unsubscribeAll();
      if (redis.clientInstance.isOpen) await redis.clientInstance.quit();
    }
    await mongoose.disconnect();
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const path = `/api/messaging/conversations/${conversationPublicId}`;
  const authorization = (person = 0) => `Bearer ${tokens[person]}`;
  const change = (action: ConversationAction, person = 0) =>
    manage.execute(
      new ManageConversationCommand(
        people[person].publicId,
        conversationPublicId,
        action,
      ),
    );
  const sendText = (body: string, person = 1) =>
    send.execute(
      new SendMessageCommand(people[person].publicId, {
        conversationPublicId,
        body,
      }),
    );
  const list = (person = 0) =>
    request(app)
      .get("/api/messaging/conversations")
      .set("Authorization", authorization(person));
  const history = (person = 0, page = 1, limit = 30) =>
    request(app)
      .get(`${path}/messages?page=${page}&limit=${limit}`)
      .set("Authorization", authorization(person));
  async function state() {
    return {
      conversation: await Conversation.findById(conversationId).lean(),
      messages: await Message.find({ conversation: conversationId })
        .sort({ _id: 1 })
        .lean(),
      notifications: await Notification.find().sort({ _id: 1 }).lean(),
      outbox: await OutboxModel.find().sort({ _id: 1 }).lean(),
    };
  }

  it("enforces session, UUID, membership and current admin authorization at HTTP boundaries", async () => {
    expect((await request(app).delete(path)).status).to.equal(401);
    expect(
      (
        await request(app)
          .delete("/api/messaging/conversations/invalid")
          .set("Authorization", authorization())
      ).status,
    ).to.equal(400);
    expect(
      (await request(app).delete(path).set("Authorization", authorization(3)))
        .status,
    ).to.equal(403);
    for (const [method, suffix] of [
      ["delete", "/purge"],
      ["post", "/lock"],
    ] as const) {
      expect(
        (
          await request(app)
            [method](`${path}${suffix}`)
            .set("Authorization", authorization())
        ).status,
      ).to.equal(403);
    }
    expect(
      await Message.countDocuments({ conversation: conversationId }),
    ).to.equal(2);
    expect(await OutboxModel.countDocuments()).to.equal(0);
    await User.updateOne({ _id: admin._id }, { $set: { isAdmin: false } });
    expect(
      (
        await request(app)
          .delete(`${path}/purge`)
          .set("Authorization", authorization(2))
      ).status,
    ).to.equal(403);
    expect(await Conversation.exists({ _id: conversationId })).not.to.equal(
      null,
    );
  });

  it("deletes only the caller's inbox/history/notifications and targets only their sessions", async () => {
    await Notification.create(
      people
        .slice(0, 2)
        .map((user) => ({
          userId: user.publicId,
          actionType: "message",
          actorId: admin.publicId,
          targetId: conversationPublicId,
          targetType: "conversation",
          targetPreview: "Private history",
        })),
    );
    const before = await state();
    expect(
      (await request(app).delete(path).set("Authorization", authorization()))
        .status,
    ).to.equal(204);
    expect((await list()).body.conversations).to.deep.equal([]);
    expect((await history()).status).to.equal(404);
    expect(
      (await list(1)).body.conversations.map(
        (c: { publicId: string }) => c.publicId,
      ),
    ).to.deep.equal([conversationPublicId]);
    expect(
      (await history(1)).body.messages.map((m: { body: string }) => m.body),
    ).to.deep.equal(["Private history 0", "Private history 1"]);
    expect(
      await Message.countDocuments({ conversation: conversationId }),
    ).to.equal(before.messages.length);
    expect(
      await Notification.countDocuments({ userId: alice.publicId }),
    ).to.equal(0);
    expect(
      await Notification.countDocuments({ userId: bob.publicId }),
    ).to.equal(1);
    const event = await OutboxModel.findOne({
      eventType: ConversationsChangedEvent.type,
    }).lean();
    expect(event!.payload.participantPublicIds).to.deep.equal([alice.publicId]);
    expect(JSON.stringify(event!.payload)).not.to.contain(conversationPublicId);
    expect(await metrics.getMetrics()).to.match(
      /conversation_actions_total\{[^}]*action="delete"[^}]*outcome="succeeded"[^}]*\} 1(?:\n|$)/,
    );
  });

  it("reopening by recipient preserves the clearing boundary and hides the old preview", async () => {
    await change("delete");
    const reopened = await request(app)
      .post("/api/messaging/conversations/initiate")
      .set("Authorization", authorization())
      .send({ recipientPublicId: bob.publicId });
    expect(reopened.status).to.equal(201);
    expect(reopened.body.conversation.publicId).to.equal(conversationPublicId);
    expect(reopened.body.conversation.lastMessage).to.equal(null);
    expect((await history()).body).to.include({ total: 0, totalPages: 0 });
    expect((await history(1)).body.total).to.equal(2);
    expect(await Conversation.countDocuments()).to.equal(1);
  });

  it("shows only new messages after deletion, including pagination and preview", async () => {
    await change("delete");
    await sendText("Fresh history");
    const first = await history(0, 1, 1);
    expect(first.status).to.equal(200);
    expect(first.body).to.include({ total: 1, totalPages: 1 });
    expect(
      first.body.messages.map((m: { body: string }) => m.body),
    ).to.deep.equal(["Fresh history"]);
    expect((await history(0, 2, 1)).body.messages).to.deep.equal([]);
    expect((await history(1)).body.total).to.equal(3);
    expect((await list()).body.conversations[0].lastMessage.body).to.equal(
      "Fresh history",
    );
    expect(await Message.countDocuments()).to.equal(3);
  });

  it("preserves fresh messages even when the stored conversation timestamp is ahead of the clock", async () => {
    const future = new Date(Date.now() + 10_000);
    await Conversation.updateOne(
      { _id: conversationId },
      { $set: { lastMessageAt: future } },
    );
    await change("delete");
    const result = await sendText("After the clearing boundary");
    expect(new Date(result.createdAt).getTime()).to.be.greaterThan(
      future.getTime(),
    );
    expect(
      (await history()).body.messages.map((m: { body: string }) => m.body),
    ).to.deep.equal(["After the clearing boundary"]);
  });

  it("counts the first message in a newly created conversation exactly once", async () => {
    const result = await send.execute(
      new SendMessageCommand(alice.publicId, {
        recipientPublicId: outsider.publicId,
        body: "First message",
      }),
    );
    const created = await Conversation.findOne({
      publicId: result.conversationId,
    }).lean();
    expect(created!.unreadCounts).to.deep.equal({
      [String(alice._id)]: 0,
      [String(outsider._id)]: 1,
    });
    expect(
      await Message.countDocuments({ conversation: created!._id }),
    ).to.equal(1);
    expect(
      await OutboxModel.countDocuments({
        "payload.conversationPublicId": result.conversationId,
        eventType: MessageSentEvent.type,
      }),
    ).to.equal(1);
  });

  it("keeps both clearing boundaries when both participants delete and later resume", async () => {
    await change("delete");
    await change("delete", 1);
    expect((await list()).body.conversations).to.deep.equal([]);
    expect((await list(1)).body.conversations).to.deep.equal([]);
    await sendText("Resumed");
    for (const person of [0, 1]) {
      const result = await history(person);
      expect(
        result.body.messages.map((m: { body: string }) => m.body),
      ).to.deep.equal(["Resumed"]);
      expect(result.body.total).to.equal(1);
    }
    expect(await Message.countDocuments()).to.equal(3);
  });

  it("prevents editing or deleting cleared history through old message URLs", async () => {
    await change("delete");
    await sendText("Visible again");
    const messagePath = `/api/messaging/messages/${oldMessagePublicIds[0]}`;
    expect(
      (
        await request(app)
          .patch(messagePath)
          .set("Authorization", authorization())
          .send({ body: "Overwrite" })
      ).status,
    ).to.equal(404);
    expect(
      (
        await request(app)
          .delete(messagePath)
          .set("Authorization", authorization())
      ).status,
    ).to.equal(404);
    expect((await Message.findById(oldMessageIds[0]))!.body).to.equal(
      "Private history 0",
    );
  });

  it("locks all write/deletion paths, stays readable, and unlocks through the admin route", async () => {
    expect(
      (
        await request(app)
          .post(`${path}/lock`)
          .set("Authorization", authorization(2))
      ).status,
    ).to.equal(204);
    expect((await list()).body.conversations[0].isLocked).to.equal(true);
    expect((await history()).body.total).to.equal(2);
    for (const payload of [
      { conversationPublicId, body: "blocked" },
      { recipientPublicId: bob.publicId, body: "blocked" },
    ]) {
      expect(
        (
          await request(app)
            .post("/api/messaging/messages")
            .set("Authorization", authorization())
            .send(payload)
        ).status,
      ).to.equal(403);
    }
    expect(
      (await request(app).delete(path).set("Authorization", authorization()))
        .status,
    ).to.equal(403);
    const messagePath = `/api/messaging/messages/${oldMessagePublicIds[0]}`;
    expect(
      (
        await request(app)
          .patch(messagePath)
          .set("Authorization", authorization())
          .send({ body: "blocked" })
      ).status,
    ).to.equal(403);
    expect(
      (
        await request(app)
          .delete(messagePath)
          .set("Authorization", authorization())
      ).status,
    ).to.equal(403);
    expect(await Message.countDocuments()).to.equal(2);
    expect((await Message.findById(oldMessageIds[0]))!.body).to.equal(
      "Private history 0",
    );
    expect(
      (
        await request(app)
          .delete(`${path}/lock`)
          .set("Authorization", authorization(2))
      ).status,
    ).to.equal(204);
    await sendText("Unlocked");
    expect(
      (await request(app).delete(path).set("Authorization", authorization()))
        .status,
    ).to.equal(204);
  });

  it("physically purges associated records, then removes caches/logs without touching unrelated data", async () => {
    const unrelatedId = new mongoose.Types.ObjectId();
    const unrelatedPublicId = asConversationPublicId(randomUUID());
    await Conversation.create({
      _id: unrelatedId,
      publicId: unrelatedPublicId,
      participantHash: "unrelated",
      participants: [bob._id, outsider._id],
    });
    await Message.create({
      conversation: unrelatedId,
      sender: bob._id,
      body: "Keep this",
    });
    const notification = await Notification.create({
      userId: alice.publicId,
      actorId: bob.publicId,
      actionType: "message",
      targetId: conversationPublicId,
      targetType: "conversation",
      targetPreview: "Private history",
    });
    await Notification.create({
      userId: outsider.publicId,
      actorId: bob.publicId,
      actionType: "message",
      targetId: unrelatedPublicId,
      targetType: "conversation",
    });
    await redis.pushNotification(alice.publicId, notification);
    const log = await RequestLogModel.create({
      timestamp: new Date(),
      metadata: {
        route: `${path}/messages`,
        method: "GET",
        ip: "127.0.0.1",
        statusCode: 200,
        responseTimeMs: 1,
      },
    });
    const keepLog = await RequestLogModel.create({
      timestamp: new Date(),
      metadata: {
        route: "/unrelated",
        method: "GET",
        ip: "127.0.0.1",
        statusCode: 200,
        responseTimeMs: 1,
      },
    });
    await sendText("Pending notification");
    const pending = await OutboxModel.findOne({
      eventType: MessageSentEvent.type,
    }).lean();
    expect(pending).not.to.equal(null);
    expect(
      (
        await request(app)
          .delete(`${path}/purge`)
          .set("Authorization", authorization(2))
      ).status,
    ).to.equal(204);
    expect(await Conversation.findById(conversationId)).to.equal(null);
    expect(
      await Message.countDocuments({ conversation: conversationId }),
    ).to.equal(0);
    expect(
      await Notification.countDocuments({ targetId: conversationPublicId }),
    ).to.equal(0);
    expect(
      await OutboxModel.countDocuments({
        "payload.conversationPublicId": conversationPublicId,
      }),
    ).to.equal(0);
    expect(JSON.stringify(await OutboxModel.find().lean())).not.to.contain(
      conversationPublicId,
    );
    await worker.poll();
    expect(await RequestLogModel.findById(log._id)).to.equal(null);
    expect(await RequestLogModel.exists({ _id: keepLog._id })).not.to.equal(
      null,
    );
    expect(
      await redis.clientInstance.exists(
        CacheKeyBuilder.getNotificationHashKey(String(notification._id)),
      ),
    ).to.equal(0);
    expect(await redis.getUserNotificationIds(alice.publicId)).to.deep.equal(
      [],
    );
    expect(await Conversation.exists({ _id: unrelatedId })).not.to.equal(null);
    expect(
      await Message.countDocuments({ conversation: unrelatedId }),
    ).to.equal(1);
    expect(
      await Notification.countDocuments({ targetId: unrelatedPublicId }),
    ).to.equal(1);
    await events.publishByType(MessageSentEvent.type, pending!.payload);
    expect(
      await Notification.countDocuments({ targetId: conversationPublicId }),
    ).to.equal(0);
    for (const person of [0, 1])
      expect((await history(person)).status).to.equal(404);
  });

  for (const action of ["delete", "lock", "purge"] as const) {
    it(`rolls back ${action} entirely if staging its invalidation fails`, async () => {
      await Notification.create({
        userId: alice.publicId,
        actorId: bob.publicId,
        actionType: "message",
        targetId: conversationPublicId,
        targetType: "conversation",
      });
      const before = await state();
      const failure = new Error("Injected outbox failure");
      sinon.stub(events, "queueTransactional").rejects(failure);
      const error = await change(action, action === "delete" ? 0 : 2).catch(
        (reason: unknown) => reason,
      );
      expect(error).to.equal(failure);
      expect(await state()).to.deep.equal(before);
      expect(await metrics.getMetrics()).to.contain(
        `action="${action}",outcome="failed"} 1`,
      );
      expect(await metrics.getMetrics()).not.to.contain(
        `action="${action}",outcome="succeeded"} 1`,
      );
    });
  }

  async function firstMutationHoldsLock(
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    const locked = deferred();
    const release = deferred();
    const secondEntered = deferred();
    const acquire = conversations.acquireForMutation.bind(conversations);
    let count = 0;
    sinon.stub(conversations, "acquireForMutation").callsFake(async (id) => {
      const call = ++count;
      if (call === 2) secondEntered.resolve();
      const result = await acquire(id);
      if (call === 1) {
        locked.resolve();
        await release.promise;
      }
      return result;
    });
    const firstResult = first();
    await locked.promise;
    const secondResult = second().then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    try {
      await secondEntered.promise;
    } finally {
      release.resolve();
    }
    return { first: await firstResult, second: await secondResult };
  }

  it("serializes delete before a concurrent send without leaking old history", async () => {
    const result = await firstMutationHoldsLock(
      () => change("delete"),
      () => sendText("Concurrent fresh message"),
    );
    expect(result.second.error).to.equal(null);
    expect(
      (await history()).body.messages.map((m: { body: string }) => m.body),
    ).to.deep.equal(["Concurrent fresh message"]);
    expect((await history(1)).body.total).to.equal(3);
  });

  it("clears a message that commits immediately before the participant's deletion", async () => {
    const result = await firstMutationHoldsLock(
      () => sendText("Before deletion"),
      () => change("delete"),
    );
    expect(result.second.error).to.equal(null);
    expect((await history()).status).to.equal(404);
    expect((await history(1)).body.total).to.equal(3);
    await bus.dispatch(
      new InitiateConversationCommand(alice.publicId, bob.publicId),
    );
    expect((await history()).body.total).to.equal(0);
  });

  it("rejects a concurrent send after the admin lock commits", async () => {
    const result = await firstMutationHoldsLock(
      () => change("lock", 2),
      () => sendText("Must not commit"),
    );
    expect(result.second.error).to.have.property("statusCode", 403);
    expect(await Message.countDocuments()).to.equal(2);
    expect(
      await OutboxModel.countDocuments({ eventType: MessageSentEvent.type }),
    ).to.equal(0);
  });

  it("rejects an in-flight send after purge instead of creating orphan messages", async () => {
    const result = await firstMutationHoldsLock(
      () => change("purge", 2),
      () => sendText("Must not survive"),
    );
    expect(result.second.error).to.have.property("statusCode", 404);
    expect(await Message.countDocuments()).to.equal(0);
    expect(await Conversation.countDocuments()).to.equal(0);
    expect(
      await OutboxModel.countDocuments({ eventType: MessageSentEvent.type }),
    ).to.equal(0);
  });

  it("purges a message and event that commit immediately before admin purge", async () => {
    const result = await firstMutationHoldsLock(
      () => sendText("Before purge"),
      () => change("purge", 2),
    );
    expect(result.second.error).to.equal(null);
    expect(await Message.countDocuments()).to.equal(0);
    expect(
      await OutboxModel.countDocuments({ eventType: MessageSentEvent.type }),
    ).to.equal(0);
  });

  it("does not recreate a deleted participant's notifications from a pending send event", async () => {
    await sendText("Queued before deletion");
    await change("delete");
    await worker.poll();
    expect(
      await Notification.countDocuments({ userId: alice.publicId }),
    ).to.equal(0);
    expect((await list()).body.conversations).to.deep.equal([]);
    expect(await Message.countDocuments()).to.equal(3);
  });

  it("does not serve a purged notification from a stale Redis cache", async () => {
    const notification = await Notification.create({
      userId: alice.publicId,
      actorId: bob.publicId,
      actionType: "message",
      targetId: conversationPublicId,
      targetType: "conversation",
      targetPreview: "Must disappear",
    });
    await redis.pushNotification(alice.publicId, notification);
    await change("purge", 2);
    expect(await redis.getUserNotificationIds(alice.publicId)).to.have.length(
      1,
    );
    const result = await new GetNotificationsQueryHandler(
      notifications,
      redis,
    ).execute(new GetNotificationsQuery(alice.publicId, 1));
    expect(result).to.deep.equal([]);
    expect(await redis.getUserNotificationIds(alice.publicId)).to.deep.equal(
      [],
    );
  });

  it("retries failed cleanup through the real outbox and records the eventual success", async () => {
    await change("purge", 2);
    sinon
      .stub(redis, "publish")
      .onFirstCall()
      .rejects(new Error("Injected Redis outage"));
    await worker.poll();
    const failed = await OutboxModel.findOne({
      eventType: ConversationsChangedEvent.type,
    }).lean();
    expect(failed).to.include({ processed: false, retries: 1 });
    expect(await Message.countDocuments()).to.equal(0);
    sinon.restore();
    await OutboxModel.updateOne(
      { _id: failed!._id },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await worker.poll();
    expect(await OutboxModel.findById(failed!._id).lean()).to.include({
      processed: true,
    });
    const exposed = await metrics.getMetrics();
    expect(exposed).to.match(
      /conversation_cleanup_attempts_total\{[^}]*outcome="failed"[^}]*\} 1(?:\n|$)/,
    );
    expect(exposed).to.match(
      /conversation_cleanup_attempts_total\{[^}]*outcome="succeeded"[^}]*\} 1(?:\n|$)/,
    );
    expect(exposed).not.to.contain(conversationPublicId);
  });

  it("delivers invalidation through Redis to real authenticated sockets with participant isolation", async () => {
    const http = createServer();
    const socketServer = new WebSocketServer(
      redis,
      auth,
      metrics,
      conversations,
      users,
    );
    const clients: Socket[] = [];
    let realtime: RealTimeFeedService | undefined;
    try {
      socketServer.initialize(http);
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const address = http.address();
      if (!address || typeof address === "string")
        throw new Error("Missing socket address");
      const subscribe = sinon.spy(redis, "subscribe");
      realtime = new RealTimeFeedService(
        redis,
        socketServer,
        [new RealtimeConversationsChangedHandler(metrics)],
        metrics,
      );
      expect(await subscribe.lastCall.returnValue).to.equal(true);
      const received: unknown[][] = [[], [], []];
      for (const [index, person] of [0, 1, 3].entries()) {
        const client = io(`http://127.0.0.1:${address.port}`, {
          autoConnect: false,
          reconnection: false,
          transports: ["websocket"],
          extraHeaders: { Origin: "https://app.example.test" },
          auth: { token: tokens[person] },
        });
        clients.push(client);
        client.on("messaging_update", (event: unknown) =>
          received[index].push(event),
        );
        const joined = new Promise<{ success: boolean }>((resolve, reject) => {
          client.once("join_response", resolve);
          client.once("connect_error", reject);
        });
        client.connect();
        expect((await joined).success).to.equal(true);
      }
      const first = new Promise<void>((resolve) =>
        clients[0].once("messaging_update", () => resolve()),
      );
      await change("delete");
      await worker.poll();
      await first;
      expect(received.map((events) => events.length)).to.deep.equal([1, 0, 0]);
      const both = clients
        .slice(0, 2)
        .map(
          (client) =>
            new Promise<void>((resolve) =>
              client.once("messaging_update", () => resolve()),
            ),
        );
      await change("lock", 2);
      await worker.poll();
      await Promise.all(both);
      expect(received.map((events) => events.length)).to.deep.equal([2, 1, 0]);
      expect(received[0][0]).to.include({ type: "conversations_changed" });
      expect(JSON.stringify(received)).not.to.contain(conversationPublicId);
    } finally {
      for (const client of clients) client.disconnect();
      realtime?.stop();
      await socketServer.close();
      if (http.listening)
        await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
