import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import sinon from "sinon";
import { Types } from "mongoose";
import { BanUserCommand } from "@/application/commands/admin/banUser/banUser.command";
import { BanUserCommandHandler } from "@/application/commands/admin/banUser/banUser.handler";
import { UserBannedEvent } from "@/application/events/user/user-interaction.event";
import { asUserPublicId } from "@/types/branded";

chai.use(chaiAsPromised);

const TARGET_PUBLIC_ID = asUserPublicId(
  "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
);
const ADMIN_PUBLIC_ID = asUserPublicId(
  "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
);

describe("BanUserCommandHandler", () => {
  let mocks: any;
  let handler: BanUserCommandHandler;
  let target: any;
  let admin: any;

  beforeEach(() => {
    const targetId = new Types.ObjectId();
    const adminId = new Types.ObjectId();
    target = {
      _id: targetId,
      id: targetId.toHexString(),
      publicId: TARGET_PUBLIC_ID,
      handle: "target",
      username: "Target",
      email: "target@example.test",
      avatar: "",
      cover: "",
    };
    admin = {
      _id: adminId,
      id: adminId.toHexString(),
      publicId: ADMIN_PUBLIC_ID,
      handle: "admin",
      username: "Admin",
      email: "admin@example.test",
    };
    mocks = {
      userRead: {
        findByPublicId: sinon
          .stub()
          .callsFake(async (publicId) =>
            publicId === ADMIN_PUBLIC_ID ? admin : target,
          ),
      },
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
          tombstonedCommentCount: 1,
          preservedConversationCount: 1,
        }),
      },
      audit: { capture: sinon.stub().resolves("snapshot-id") },
      authSession: { revokeAllSessionsForUser: sinon.stub().resolves() },
      dto: { toAdminDTO: sinon.stub().returns({ publicId: TARGET_PUBLIC_ID }) },
    };
    handler = new BanUserCommandHandler(
      mocks.userRead,
      mocks.unitOfWork,
      mocks.eventBus,
      mocks.lifecycle,
      mocks.audit,
      mocks.authSession,
      mocks.dto,
    );
  });

  afterEach(() => sinon.restore());

  it("captures evidence and destructively purges before emitting the ban event", async () => {
    const result = await handler.execute(
      new BanUserCommand(TARGET_PUBLIC_ID, ADMIN_PUBLIC_ID, "abusive behavior"),
    );

    expect(mocks.audit.capture.calledOnce).to.equal(true);
    expect(mocks.audit.capture.firstCall.args[0]).to.include({
      action: "ban",
      reason: "abusive behavior",
      targetUserPublicId: TARGET_PUBLIC_ID,
    });
    expect(mocks.authSession.revokeAllSessionsForUser.calledWith(TARGET_PUBLIC_ID))
      .to.equal(true);
    expect(mocks.lifecycle.purgeUser.firstCall.args[1]).to.include({
      action: "ban",
      reason: "abusive behavior",
    });
    expect(
      mocks.eventBus.queueTransactional.firstCall.args[0],
    ).to.be.instanceOf(UserBannedEvent);
    expect(result.user).to.deep.equal({ publicId: TARGET_PUBLIC_ID });
  });

  it("blocks the ban when the evidence snapshot cannot be persisted", async () => {
    mocks.audit.capture.rejects(new Error("audit unavailable"));
    await expect(
      handler.execute(
        new BanUserCommand(TARGET_PUBLIC_ID, ADMIN_PUBLIC_ID, "reason"),
      ),
    ).to.be.rejectedWith("audit unavailable");
    expect(mocks.authSession.revokeAllSessionsForUser.called).to.equal(false);
    expect(mocks.lifecycle.purgeUser.called).to.equal(false);
  });

  it("does not allow an administrator to ban their own account", async () => {
    await expect(
      handler.execute(
        new BanUserCommand(ADMIN_PUBLIC_ID, ADMIN_PUBLIC_ID, "mistake"),
      ),
    ).to.be.rejectedWith("cannot ban their own account");
    expect(mocks.audit.capture.called).to.equal(false);
  });
});
