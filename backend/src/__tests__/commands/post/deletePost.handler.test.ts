import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import sinon from "sinon";
import { Types } from "mongoose";
import { DeletePostCommand } from "@/application/commands/post/deletePost/deletePost.command";
import { DeletePostCommandHandler } from "@/application/commands/post/deletePost/deletePost.handler";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { asPostPublicId, asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const USER_PUBLIC_ID = asUserPublicId(
  "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
);
const POST_PUBLIC_ID = asPostPublicId(
  "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
);

describe("DeletePostCommandHandler", () => {
  const session = {};
  let mocks: any;
  let handler: DeletePostCommandHandler;

  beforeEach(() => {
    mocks = {
      unitOfWork: {
        executeInTransaction: sinon.stub().callsFake(async (work) =>
          work(session),
        ),
      },
      postRead: { findByPublicId: sinon.stub() },
      userRead: { findByPublicId: sinon.stub() },
      communityMember: { findByCommunityAndUser: sinon.stub() },
      cleanup: { deletePostGraph: sinon.stub() },
      eventBus: { queueTransactional: sinon.stub().resolves() },
    };
    handler = new DeletePostCommandHandler(
      mocks.unitOfWork,
      mocks.postRead,
      mocks.userRead,
      mocks.communityMember,
      mocks.cleanup,
      mocks.eventBus,
    );
  });

  afterEach(() => sinon.restore());

  it("fails when the post does not exist", async () => {
    mocks.postRead.findByPublicId.resolves(null);
    await expect(
      handler.execute(new DeletePostCommand(POST_PUBLIC_ID, USER_PUBLIC_ID)),
    ).to.be.rejectedWith("Post not found");
  });

  it("fails when the requester does not exist", async () => {
    mocks.postRead.findByPublicId.resolves({
      _id: new Types.ObjectId(),
      publicId: POST_PUBLIC_ID,
      user: new Types.ObjectId(),
    });
    mocks.userRead.findByPublicId.resolves(null);
    await expect(
      handler.execute(new DeletePostCommand(POST_PUBLIC_ID, USER_PUBLIC_ID)),
    ).to.be.rejectedWith("User not found");
  });

  it("deletes the complete post graph and queues durable cleanup events", async () => {
    const ownerId = new Types.ObjectId();
    const dependentPostPublicId = asPostPublicId(
      "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
    );
    mocks.postRead.findByPublicId.resolves({
      _id: new Types.ObjectId(),
      publicId: POST_PUBLIC_ID,
      user: ownerId,
      author: { publicId: USER_PUBLIC_ID },
    });
    mocks.userRead.findByPublicId.resolves({
      _id: ownerId,
      id: ownerId.toHexString(),
      publicId: USER_PUBLIC_ID,
      isAdmin: false,
    });
    mocks.cleanup.deletePostGraph.resolves({
      posts: [
        {
          internalId: new Types.ObjectId(),
          publicId: POST_PUBLIC_ID,
          authorPublicId: USER_PUBLIC_ID,
        },
        {
          internalId: new Types.ObjectId(),
          publicId: dependentPostPublicId,
          authorPublicId: USER_PUBLIC_ID,
        },
      ],
      imageAssets: [
        {
          storagePublicId: "folder/asset",
          url: "https://example.test/asset.jpg",
          ownerPublicId: USER_PUBLIC_ID,
        },
      ],
    });

    const result = await handler.execute(
      new DeletePostCommand(POST_PUBLIC_ID, USER_PUBLIC_ID),
    );

    expect(mocks.cleanup.deletePostGraph.calledOnce).to.equal(true);
    expect(mocks.eventBus.queueTransactional.callCount).to.equal(3);
    expect(
      mocks.eventBus.queueTransactional.firstCall.args[0],
    ).to.be.instanceOf(PostDeletedEvent);
    expect(
      mocks.eventBus.queueTransactional.thirdCall.args[0],
    ).to.be.instanceOf(ImageAssetCleanupRequestedEvent);
    expect(result).to.deep.equal({ message: "Post deleted successfully" });
  });

  it("rejects a requester who is neither owner, admin, nor community moderator", async () => {
    mocks.postRead.findByPublicId.resolves({
      _id: new Types.ObjectId(),
      publicId: POST_PUBLIC_ID,
      user: new Types.ObjectId(),
      communityId: new Types.ObjectId(),
    });
    mocks.userRead.findByPublicId.resolves({
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toHexString(),
      publicId: USER_PUBLIC_ID,
      isAdmin: false,
    });
    mocks.communityMember.findByCommunityAndUser.resolves(null);

    await expect(
      handler.execute(new DeletePostCommand(POST_PUBLIC_ID, USER_PUBLIC_ID)),
    ).to.be.rejectedWith("permission");
    expect(mocks.cleanup.deletePostGraph.called).to.equal(false);
  });
});
