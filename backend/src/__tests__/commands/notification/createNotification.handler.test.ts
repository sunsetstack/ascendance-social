import { expect } from "chai";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { CreateNotificationCommandHandler } from "@/application/commands/notification/createNotification/createNotification.handler";
import { EventRegistry } from "@/application/common/events/event-registry";
import { NotificationMessageHandler } from "@/application/handlers/realtime/NotificationMessageHandler";

describe("CreateNotificationCommandHandler", () => {
  afterEach(() => sinon.restore());

  it("routes realtime delivery through Redis for worker-safe cross-process delivery", async () => {
    const notification = {
      _id: "notification-id",
      toJSON: () => ({
        _id: "notification-id",
        userId: "receiver-id",
        actionType: "follow",
        actorId: "actor-id",
        isRead: false,
      }),
    };
    const notificationRepository = {
      createOnce: sinon.stub().resolves(notification),
      create: sinon.stub(),
    };
    const userReadRepository = { findByPublicId: sinon.stub() };
    const redisService = {
      pushNotification: sinon.stub().resolves(),
      publish: sinon.stub().resolves(),
    };
    const handler = new CreateNotificationCommandHandler(
      notificationRepository as any,
      userReadRepository as any,
      redisService as any,
    );

    await handler.execute(
      new CreateNotificationCommand({
        receiverId: "receiver-id",
        actionType: "follow",
        actorId: "actor-id",
        actorUsername: "Actor",
        actorHandle: "actor",
        actorAvatar: "avatar.png",
        idempotencyKey: "follow:actor-id:receiver-id",
      }),
    );

    expect(redisService.pushNotification.calledOnce).to.equal(true);
    expect(
      redisService.publish.calledOnceWith(
        EventRegistry.redisChannels.notificationUpdates,
        sinon.match({
          type: EventRegistry.realtimeMessageTypes.newNotification,
          userId: "receiver-id",
          eventId: "new_notification:notification-id",
        }),
      ),
    ).to.equal(true);
  });
});

describe("NotificationMessageHandler", () => {
  afterEach(() => sinon.restore());

  it("delivers worker-created notifications through the API websocket room", async () => {
    const emit = sinon.stub();
    const to = sinon.stub().returns({ emit });
    const metrics = { recordSocketEventEmitted: sinon.stub() };
    const handler = new NotificationMessageHandler(metrics as any);

    await handler.handle(
      { to } as any,
      {
        type: EventRegistry.realtimeMessageTypes.newNotification,
        eventId: "new_notification:notification-id",
        userId: "receiver-id",
        notification: {
          _id: "notification-id",
          userId: "receiver-id" as any,
          actionType: "follow",
          actorId: "actor-id" as any,
          isRead: false,
        },
        timestamp: new Date().toISOString(),
      },
      EventRegistry.redisChannels.notificationUpdates,
    );

    expect(to.calledOnceWith("receiver-id")).to.equal(true);
    expect(
      emit.calledOnceWith(
        EventRegistry.socketServerEvents.newNotification,
        sinon.match({
          _id: "notification-id",
          eventId: "new_notification:notification-id",
        }),
      ),
    ).to.equal(true);
    expect(metrics.recordSocketEventEmitted.calledOnce).to.equal(true);
  });
});
