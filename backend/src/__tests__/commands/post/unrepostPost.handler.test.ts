import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import sinon from "sinon";
import { Types } from "mongoose";
import { UnrepostPostCommand } from "@/application/commands/post/unrepostPost/unrepostPost.command";
import { UnrepostPostCommandHandler } from "@/application/commands/post/unrepostPost/unrepostPost.handler";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { asPostPublicId, asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const USER_PUBLIC_ID = asUserPublicId(
  "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
);
const TARGET_PUBLIC_ID = asPostPublicId(
  "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
);

describe("UnrepostPostCommandHandler", () => {
  let mocks: any;
  let handler: UnrepostPostCommandHandler;

  beforeEach(() => {
    mocks = {
      unitOfWork: {
        executeInTransaction: sinon.stub().callsFake(async (work) => work({})),
      },
      postRead: {
        findByPublicId: sinon.stub(),
        findOneByFilter: sinon.stub(),
      },
      userRead: { findByPublicId: sinon.stub() },
      cleanup: { deletePostGraph: sinon.stub() },
      eventBus: { queueTransactional: sinon.stub().resolves() },
    };
    handler = new UnrepostPostCommandHandler(
      mocks.unitOfWork,
      mocks.postRead,
      mocks.userRead,
      mocks.cleanup,
      mocks.eventBus,
    );
  });

  afterEach(() => sinon.restore());

  it("rejects an invalid user id", async () => {
    await expect(
      handler.execute(
        new UnrepostPostCommand(
          asUserPublicId("not-a-uuid"),
          TARGET_PUBLIC_ID,
        ),
      ),
    ).to.be.rejectedWith("Invalid userPublicId format");
  });

  it("rejects a missing repost", async () => {
    const userId = new Types.ObjectId();
    mocks.userRead.findByPublicId.resolves({ _id: userId });
    mocks.postRead.findByPublicId.resolves({ _id: new Types.ObjectId() });
    mocks.postRead.findOneByFilter.resolves(null);
    await expect(
      handler.execute(new UnrepostPostCommand(USER_PUBLIC_ID, TARGET_PUBLIC_ID)),
    ).to.be.rejectedWith("You have not reposted this post");
  });

  it("uses graph cleanup and queues the delete event inside the transaction", async () => {
    const userId = new Types.ObjectId();
    const repostId = new Types.ObjectId();
    const repostPublicId = asPostPublicId(
      "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
    );
    mocks.userRead.findByPublicId.resolves({ _id: userId });
    mocks.postRead.findByPublicId.resolves({ _id: new Types.ObjectId() });
    mocks.postRead.findOneByFilter.resolves({
      _id: repostId,
      publicId: repostPublicId,
      type: "repost",
    });
    mocks.cleanup.deletePostGraph.resolves({
      posts: [
        {
          internalId: repostId,
          publicId: repostPublicId,
          authorPublicId: USER_PUBLIC_ID,
        },
      ],
      imageAssets: [],
    });

    const result = await handler.execute(
      new UnrepostPostCommand(USER_PUBLIC_ID, TARGET_PUBLIC_ID),
    );

    expect(mocks.cleanup.deletePostGraph.calledOnce).to.equal(true);
    expect(mocks.eventBus.queueTransactional.calledOnce).to.equal(true);
    expect(
      mocks.eventBus.queueTransactional.firstCall.args[0],
    ).to.be.instanceOf(PostDeletedEvent);
    expect(result).to.deep.equal({ message: "Repost removed successfully" });
  });
});
