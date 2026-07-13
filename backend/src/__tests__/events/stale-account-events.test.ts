import { expect } from "chai";
import sinon from "sinon";
import { MessageSentHandler } from "@/application/events/message/message-sent.handler";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { NotificationRequestedHandler } from "@/application/events/notification/notification-requested.handler";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import {
  asConversationPublicId,
  asMessagePublicId,
  asUserPublicId,
} from "@/types/branded";

describe("stale account events", () => {
  it("drops a delayed notification after its actor is deleted", async () => {
    const dispatch = sinon.stub().resolves();
    const receiverId = asUserPublicId(
      "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    );
    const actorId = asUserPublicId(
      "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    );
    const findByPublicId = sinon.stub().callsFake(async (publicId) =>
      publicId === receiverId ? { isBanned: false } : null,
    );
    const handler = new NotificationRequestedHandler(
      { dispatch } as any,
      { findByPublicId } as any,
    );

    await handler.handle(
      new NotificationRequestedEvent({
        receiverId,
        actorId,
        actionType: "like",
      }),
    );

    expect(dispatch.called).to.equal(false);
  });

  it("drops a delayed realtime message event after its sender is deleted", async () => {
    const publish = sinon.stub().resolves();
    const dispatch = sinon.stub().resolves();
    const findByPublicId = sinon.stub().resolves(null);
    const handler = new MessageSentHandler(
      { publish } as any,
      { dispatch } as any,
      { findByPublicId } as any,
    );

    await handler.handle(
      new MessageSentEvent(
        asConversationPublicId(
          "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
        ),
        asUserPublicId("d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7"),
        [asUserPublicId("e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b")],
        asMessagePublicId("f6a7b8c9-d0e1-4f2a-8b3c-4d5e6f7a8b9c"),
      ),
    );

    expect(publish.called).to.equal(false);
    expect(dispatch.called).to.equal(false);
  });
});
