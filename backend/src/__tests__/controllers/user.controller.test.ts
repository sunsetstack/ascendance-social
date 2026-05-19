import { afterEach, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import type { Request, Response } from "express";
import { UserController } from "@/controllers/user.controller";
import { SetFollowStateCommand } from "@/application/commands/users/setFollowState/setFollowState.command";
import { asUserPublicId } from "@/types/branded";

describe("UserController follow routes", () => {
  let controller: UserController;
  let authService: {
    revokeSessionByRefreshToken: sinon.SinonStub;
    revokeSessionByAccessToken: sinon.SinonStub;
  };
  let commandBus: { dispatch: sinon.SinonStub };
  let queryBus: { execute: sinon.SinonStub };
  let res: Partial<Response>;

  const createResponse = (): Partial<Response> => {
    const response: Partial<Response> = {};
    response.status = sinon.stub().returns(response);
    response.json = sinon.stub().returns(response);
    return response;
  };

  beforeEach(() => {
    authService = {
      revokeSessionByRefreshToken: sinon.stub(),
      revokeSessionByAccessToken: sinon.stub(),
    };
    commandBus = {
      dispatch: sinon.stub(),
    };
    queryBus = {
      execute: sinon.stub(),
    };
    controller = new UserController(
      authService as unknown as never,
      commandBus as unknown as never,
      queryBus as unknown as never,
    );
    res = createResponse();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("dispatches an explicit follow command without querying current state", async () => {
    commandBus.dispatch.resolves({ action: "followed" });

    const req = {
      params: { publicId: "target-user" },
      decodedUser: { publicId: asUserPublicId("viewer-user") },
    } as unknown as Request;

    await controller.followUserByPublicId(req as never, res as Response);

    expect(commandBus.dispatch.calledOnce).to.be.true;
    const command = commandBus.dispatch.firstCall.args[0];
    expect(command).to.be.instanceOf(SetFollowStateCommand);
    expect(command.followerPublicId).to.equal(asUserPublicId("viewer-user"));
    expect(command.followeePublicId).to.equal(asUserPublicId("target-user"));
    expect(command.shouldFollow).to.equal(true);
    expect(queryBus.execute.called).to.be.false;
    expect((res.json as sinon.SinonStub).calledOnceWith({ action: "followed" })).to.be.true;
  });

  it("dispatches an explicit unfollow command without querying current state", async () => {
    commandBus.dispatch.resolves({ action: "unfollowed" });

    const req = {
      params: { publicId: "target-user" },
      decodedUser: { publicId: asUserPublicId("viewer-user") },
    } as unknown as Request;

    await controller.unfollowUserByPublicId(req as never, res as Response);

    expect(commandBus.dispatch.calledOnce).to.be.true;
    const command = commandBus.dispatch.firstCall.args[0];
    expect(command).to.be.instanceOf(SetFollowStateCommand);
    expect(command.shouldFollow).to.equal(false);
    expect(queryBus.execute.called).to.be.false;
    expect((res.json as sinon.SinonStub).calledOnceWith({ action: "unfollowed" })).to.be.true;
  });
});
