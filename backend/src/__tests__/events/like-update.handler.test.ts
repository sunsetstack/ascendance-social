import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { LikeUpdateMessageHandler } from "@/application/handlers/realtime/LikeUpdateMessageHandler";
import { registerSocketSessionValidator } from "@/server/socket-security";

describe("Realtime like counter delivery", () => {
  function fixture() {
    const emit = sinon.stub();
    const socket = {
      emit,
      disconnect: sinon.stub(),
      data: {
        authenticated: true,
        user: { publicId: "viewer", exp: Math.floor(Date.now() / 1000) + 60 },
      },
    };
    const io = { fetchSockets: sinon.stub().resolves([socket]) };
    registerSocketSessionValidator(io as never, async () => {});
    const handler = new LikeUpdateMessageHandler({
      recordSocketEventEmitted: sinon.stub(),
    } as never);
    return { handler, io, emit };
  }

  it("preserves the revision and derives a stable fallback ID from that revision", async () => {
    const { handler, io, emit } = fixture();
    await handler.handle(io as never, {
      type: "like_update",
      postId: "post",
      newLikes: 1,
      likesRevision: 3,
      timestamp: new Date().toISOString(),
    });
    expect(emit.firstCall.args[1]).to.include({
      likesRevision: 3,
      newLikes: 1,
      eventId: "like_update:post:3",
    });
  });

  it("does not reuse a count-based fallback ID for unversioned legacy updates", async () => {
    const { handler, io, emit } = fixture();
    const message = {
      type: "like_update" as const,
      postId: "post",
      newLikes: 1,
      timestamp: new Date().toISOString(),
    };
    await handler.handle(io as never, message);
    await handler.handle(io as never, message);
    expect(emit.firstCall.args[1].eventId).not.to.equal(
      emit.secondCall.args[1].eventId,
    );
  });
});
