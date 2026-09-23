import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import sinon from "sinon";
import { Types } from "mongoose";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import {
  PostDeletedEvent,
  PostLikeCountReconciledEvent,
} from "@/application/events/post/post.event";
import { UserDeletedEvent } from "@/application/events/user/user-interaction.event";
import { EventBusAccountOutboxParticipant } from "@/services/lifecycle/account-outbox.participant";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import type {
  AccountCommunityCleanupParticipant,
  AccountContentCleanupParticipant,
  AccountConversationCleanupParticipant,
  AccountLifecycleUser,
  AccountOutboxParticipant,
  AccountPurgeResult,
  AccountRecordCleanupParticipant,
  AccountSocialCleanupParticipant,
} from "@/services/lifecycle/account-lifecycle.ports";

chai.use(chaiAsPromised);

describe("AccountLifecycleService orchestration", () => {
  const user: AccountLifecycleUser = {
    _id: new Types.ObjectId(),
    publicId: "departing-public-id",
    handle: "departing",
    username: "Departing User",
    avatar: "",
    cover: "",
  };

  function createParticipants(order: string[]) {
    const content: AccountContentCleanupParticipant = {
      cleanup: sinon.stub().callsFake(async () => {
        order.push("content");
        return {
          posts: [],
          imageAssets: [],
          reconciledPostLikes: [],
          tombstonedCommentCount: 2,
        };
      }),
    };
    const social: AccountSocialCleanupParticipant = {
      captureFollowerPublicIds: sinon.stub().callsFake(async () => {
        order.push("followers");
        return ["follower-public-id"];
      }),
      removeRelationshipsAndActivity: sinon.stub().callsFake(async () => {
        order.push("social");
        return ["affected-public-id"];
      }),
    };
    const conversations: AccountConversationCleanupParticipant = {
      preserve: sinon.stub().callsFake(async () => {
        order.push("conversations");
        return 3;
      }),
    };
    const communities: AccountCommunityCleanupParticipant = {
      cleanup: sinon.stub().callsFake(async () => {
        order.push("communities");
        return { posts: [], imageAssets: [] };
      }),
    };
    const records: AccountRecordCleanupParticipant = {
      finalize: sinon.stub().callsFake(async () => {
        order.push("records");
        return [{ url: "https://example.test/avatar.jpg", ownerPublicId: user.publicId }];
      }),
    };
    const outbox: AccountOutboxParticipant = {
      enqueue: sinon.stub().callsFake(async () => {
        order.push("outbox");
      }),
    };
    return { content, social, conversations, communities, records, outbox };
  }

  it("invokes participants in order and returns the aggregate result", async () => {
    const order: string[] = [];
    const participants = createParticipants(order);
    const lifecycle = new AccountLifecycleService(
      participants.content,
      participants.social,
      participants.conversations,
      participants.communities,
      participants.records,
      participants.outbox,
    );
    const result = await lifecycle.purgeUser(user, {
      action: "delete",
      reason: "requested",
      requestedByPublicId: user.publicId,
    });

    expect(order).to.deep.equal([
      "followers",
      "content",
      "social",
      "conversations",
      "communities",
      "records",
      "outbox",
    ]);
    expect(result).to.deep.include({
      followerPublicIds: ["follower-public-id"],
      affectedRelationshipPublicIds: ["affected-public-id"],
      tombstonedCommentCount: 2,
      preservedConversationCount: 3,
    });
    expect(result.imageAssets).to.deep.equal([
      { url: "https://example.test/avatar.jpg", ownerPublicId: user.publicId },
    ]);

    expect(
      (participants.outbox.enqueue as sinon.SinonStub).firstCall.args[2],
    ).to.deep.equal(result);
  });

  it("preserves the original participant error and suppresses later participants", async () => {
    const order: string[] = [];
    const participants = createParticipants(order);
    const error = new Error("content cleanup failed");
    (participants.content.cleanup as sinon.SinonStub).rejects(error);
    const lifecycle = new AccountLifecycleService(
      participants.content,
      participants.social,
      participants.conversations,
      participants.communities,
      participants.records,
      participants.outbox,
    );

    let caught: unknown;
    try {
      await lifecycle.purgeUser(user, {
        action: "delete",
        reason: "requested",
      });
    } catch (failure) {
      caught = failure;
    }

    expect(caught).to.equal(error);
    expect(order).to.deep.equal(["followers"]);
    expect(
      (participants.social.removeRelationshipsAndActivity as sinon.SinonStub)
        .called,
    ).to.equal(false);
    expect((participants.conversations.preserve as sinon.SinonStub).called).to.equal(
      false,
    );
    expect((participants.communities.cleanup as sinon.SinonStub).called).to.equal(
      false,
    );
    expect((participants.records.finalize as sinon.SinonStub).called).to.equal(
      false,
    );
    expect((participants.outbox.enqueue as sinon.SinonStub).called).to.equal(
      false,
    );
  });

  it("keeps cleanup event ordering behind the lifecycle outbox port", async () => {
    const queueTransactional = sinon.stub().resolves();
    const outbox = new EventBusAccountOutboxParticipant({
      queueTransactional,
    } as any);
    const result: AccountPurgeResult = {
      deletedPosts: [
        {
          internalId: new Types.ObjectId(),
          publicId: "post-public-id",
          authorPublicId: user.publicId,
        },
      ],
      imageAssets: [
        { url: "https://example.test/avatar.jpg", ownerPublicId: user.publicId },
      ],
      followerPublicIds: [],
      affectedRelationshipPublicIds: [],
      reconciledPostLikes: [{ postPublicId: "post-public-id", likesCount: 0 }],
      tombstonedCommentCount: 0,
      preservedConversationCount: 0,
    };

    await outbox.enqueue(
      user,
      {
        action: "delete",
        requestedByPublicId: user.publicId,
      },
      result,
    );

    expect(queueTransactional.callCount).to.equal(4);
    expect(queueTransactional.getCall(0).args[0]).to.be.instanceOf(
      PostDeletedEvent,
    );
    expect(queueTransactional.getCall(1).args[0]).to.be.instanceOf(
      ImageAssetCleanupRequestedEvent,
    );
    expect(queueTransactional.getCall(2).args[0]).to.be.instanceOf(
      PostLikeCountReconciledEvent,
    );
    expect(queueTransactional.getCall(3).args[0]).to.be.instanceOf(
      UserDeletedEvent,
    );
  });
});
