import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import sinon from "sinon";
import { Types } from "mongoose";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { DeleteUserCommandHandler } from "@/application/commands/users/deleteUser/deleteUser.handler";
import { UserDeletedEvent } from "@/application/events/user/user-interaction.event";
import { asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const USER_PUBLIC_ID = asUserPublicId(
  "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
);

describe("DeleteUserCommandHandler", () => {
  let mocks: any;
  let handler: DeleteUserCommandHandler;
  let user: any;

  beforeEach(() => {
    const userId = new Types.ObjectId();
    user = {
      _id: userId,
      id: userId.toHexString(),
      publicId: USER_PUBLIC_ID,
      handle: "departing",
      username: "Departing User",
      email: "departing@example.test",
      avatar: "",
      cover: "",
    };
    mocks = {
      userRead: { findByPublicId: sinon.stub().resolves(user) },
      unitOfWork: {
        executeInTransaction: sinon.stub().callsFake(async (work) => work({})),
      },
      eventBus: { queueTransactional: sinon.stub().resolves() },
      lifecycle: {
        purgeUser: sinon.stub().resolves({
          deletedPosts: [],
          imageAssets: [],
          followerPublicIds: [],
          affectedRelationshipPublicIds: [],
          reconciledPostLikes: [],
          tombstonedCommentCount: 2,
          preservedConversationCount: 1,
        }),
      },
      audit: { capture: sinon.stub().resolves("snapshot-id") },
      userModel: { findOne: sinon.stub() },
      authSession: { revokeAllSessionsForUser: sinon.stub().resolves() },
    };
    handler = new DeleteUserCommandHandler(
      mocks.userRead,
      mocks.unitOfWork,
      mocks.eventBus,
      mocks.lifecycle,
      mocks.audit,
      mocks.userModel,
      mocks.authSession,
    );
  });

  afterEach(() => sinon.restore());

  it("captures evidence, revokes sessions, purges, and queues deletion", async () => {
    await handler.execute(
      new DeleteUserCommand(
        USER_PUBLIC_ID,
        undefined,
        true,
        "No longer wants the account",
      ),
    );

    expect(mocks.audit.capture.calledOnce).to.equal(true);
    expect(mocks.authSession.revokeAllSessionsForUser.calledWith(USER_PUBLIC_ID))
      .to.equal(true);
    expect(mocks.lifecycle.purgeUser.calledOnce).to.equal(true);
    expect(mocks.eventBus.queueTransactional.calledOnce).to.equal(true);
    expect(
      mocks.eventBus.queueTransactional.firstCall.args[0],
    ).to.be.instanceOf(UserDeletedEvent);
    expect(mocks.audit.capture.calledBefore(mocks.lifecycle.purgeUser)).to.equal(
      true,
    );
  });

  it("does not revoke or destroy anything when evidence capture fails", async () => {
    mocks.audit.capture.rejects(new Error("audit archive unavailable"));

    await expect(
      handler.execute(
        new DeleteUserCommand(USER_PUBLIC_ID, undefined, true, "requested"),
      ),
    ).to.be.rejectedWith("audit archive unavailable");
    expect(mocks.authSession.revokeAllSessionsForUser.called).to.equal(false);
    expect(mocks.unitOfWork.executeInTransaction.called).to.equal(false);
    expect(mocks.lifecycle.purgeUser.called).to.equal(false);
  });
});
