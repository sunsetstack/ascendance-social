import { expect } from "chai";
import sinon from "sinon";
import { EventRegistry } from "@/application/common/events/event-registry";
import { UserDeletedHandler } from "@/application/events/user/user-deleted.handler";
import { UserBannedEvent } from "@/application/events/user/user-interaction.event";
import { RedisService } from "@/services/redis.service";

describe("UserDeletedHandler", () => {
  it("recognizes a deserialized ban event by its registered type", async () => {
    const redis = {
      invalidateByTags: sinon.stub().resolves(),
      deletePatterns: sinon.stub().resolves(),
      removePostsFromFeedsBatch: sinon.stub().resolves(),
      publish: sinon.stub().resolves(),
    } as unknown as RedisService;
    const handler = new UserDeletedHandler(redis);
    const timestamp = new Date("2026-07-13T20:00:00.000Z");

    await handler.handle({
      type: EventRegistry.domain.UserBanned,
      timestamp,
      userPublicId: "departed-user",
      userId: "internal-user",
      followerPublicIds: ["follower-user"],
      affectedRelationshipPublicIds: ["related-user"],
      deletedPostPublicIds: ["removed-post"],
    } as unknown as UserBannedEvent);

    expect((redis.publish as sinon.SinonStub).calledOnce).to.equal(true);
    const payload = JSON.parse(
      (redis.publish as sinon.SinonStub).firstCall.args[1] as string,
    );
    expect(payload.type).to.equal(
      EventRegistry.realtimeMessageTypes.userBanned,
    );
    expect(payload.timestamp).to.equal(timestamp.toISOString());
    const deletedPatterns = (redis.deletePatterns as sinon.SinonStub).firstCall
      .args[0] as string[];
    expect(deletedPatterns).to.include("user_data:related-user");
    expect(deletedPatterns).to.include("following_ids:related-user");
    expect(
      (redis.removePostsFromFeedsBatch as sinon.SinonStub).calledOnceWithExactly(
        ["departed-user", "follower-user"],
        ["removed-post"],
        "for_you",
      ),
    ).to.equal(true);
  });
});
