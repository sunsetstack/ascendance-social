/**
 * CQRS bus integration tests.
 *
 * These tests use real CommandBus and QueryBus instances to verify:
 *   - Commands and queries are routed to their registered handlers
 *   - Routing is driven by the `.type` property, not `constructor.name`
 *   - Missing-handler errors are propagated with the correct type name
 *   - AppError subtypes from handlers pass through unchanged
 *   - Two different commands/queries each reach their own handler
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import type { ICommand } from "@/application/common/interfaces/command.interface";
import type { IQuery } from "@/application/common/interfaces/query.interface";
import type { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { AppError, Errors } from "@/utils/errors";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Minimal command / query fixtures
// ---------------------------------------------------------------------------

class PingCommand implements ICommand {
  readonly type = "PingCommand" as const;
  constructor(public readonly payload: string) {}
}

class OtherCommand implements ICommand {
  readonly type = "OtherCommand" as const;
}

class EchoQuery implements IQuery {
  readonly type = "EchoQuery" as const;
  constructor(public readonly text: string) {}
}

class OtherQuery implements IQuery {
  readonly type = "OtherQuery" as const;
}

// ---------------------------------------------------------------------------
// CommandBus integration
// ---------------------------------------------------------------------------

describe("CommandBus integration", () => {
  let bus: CommandBus;

  beforeEach(() => {
    bus = new CommandBus();
  });

  it("dispatches a command to its registered handler and returns the result", async () => {
    const handler: ICommandHandler<PingCommand, string> = {
      execute: sinon.stub().resolves("pong"),
    };
    bus.register(PingCommand, handler);

    const result = await bus.dispatch<string>(new PingCommand("hello"));
    expect(result).to.equal("pong");
    expect((handler.execute as sinon.SinonStub).calledOnce).to.be.true;
  });

  it("passes the exact command instance to the handler", async () => {
    const stub = sinon.stub().resolves();
    bus.register(PingCommand, { execute: stub });

    const cmd = new PingCommand("check-identity");
    await bus.dispatch(cmd);

    expect(stub.getCall(0).args[0]).to.equal(cmd);
    expect(stub.getCall(0).args[0].payload).to.equal("check-identity");
  });

  it("routes two distinct command types to their respective handlers without cross-contamination", async () => {
    const pingStub = sinon.stub().resolves("ping-result");
    const otherStub = sinon.stub().resolves("other-result");

    bus.register(PingCommand, { execute: pingStub });
    bus.register(OtherCommand, { execute: otherStub });

    const [r1, r2] = await Promise.all([
      bus.dispatch<string>(new PingCommand("x")),
      bus.dispatch<string>(new OtherCommand()),
    ]);

    expect(r1).to.equal("ping-result");
    expect(r2).to.equal("other-result");
    expect(pingStub.calledOnce).to.be.true;
    expect(otherStub.calledOnce).to.be.true;
  });

  it("throws InternalServerError containing the command type when no handler is registered", async () => {
    const err = await bus.dispatch(new PingCommand("x")).catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    const appError = err as AppError;
    expect(appError.statusCode).to.equal(500);
    expect(appError.message).to.include("PingCommand");
  });

  it("propagates AppError from handler unchanged, preserving statusCode and message", async () => {
    const notFoundErr = Errors.notFound("Post", "abc123");
    bus.register(PingCommand, {
      execute: sinon.stub().rejects(notFoundErr),
    });

    const thrown = await bus.dispatch(new PingCommand("x")).catch((e) => e);
    expect(thrown).to.equal(notFoundErr);
    const appError = thrown as AppError;
    expect(appError.statusCode).to.equal(404);
    expect(appError.message).to.include("Post");
  });

  it("dispatches using the .type property so minified constructor names still route correctly", async () => {
    // Simulate what minification does: renames the constructor but preserves static .type
    class WrappedCommand implements ICommand {
      readonly type = "PingCommand" as const;
    }
    Object.defineProperty(WrappedCommand, "name", { value: "p" });

    const stub = sinon.stub().resolves("minified-ok");
    bus.register(PingCommand, { execute: stub });

    const result = await bus.dispatch<string>(new WrappedCommand());
    expect(result).to.equal("minified-ok");
  });

  it("last-registered handler wins when the same command type is registered twice", async () => {
    const first = sinon.stub().resolves("first");
    const second = sinon.stub().resolves("second");

    bus.register(PingCommand, { execute: first });
    bus.register(PingCommand, { execute: second });

    const result = await bus.dispatch<string>(new PingCommand("x"));
    expect(result).to.equal("second");
    expect(first.called).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// QueryBus integration
// ---------------------------------------------------------------------------

describe("QueryBus integration", () => {
  let bus: QueryBus;

  beforeEach(() => {
    bus = new QueryBus();
  });

  it("executes a query via its registered handler and returns the result", async () => {
    const handler: IQueryHandler<EchoQuery, string> = {
      execute: sinon.stub().resolves("echo-result"),
    };
    bus.register(EchoQuery, handler);

    const result = await bus.execute<string>(new EchoQuery("hello"));
    expect(result).to.equal("echo-result");
  });

  it("passes the exact query instance to the handler", async () => {
    const stub = sinon.stub().resolves("x");
    bus.register(EchoQuery, { execute: stub });

    const q = new EchoQuery("check-identity");
    await bus.execute(q);

    expect(stub.getCall(0).args[0]).to.equal(q);
    expect(stub.getCall(0).args[0].text).to.equal("check-identity");
  });

  it("routes two distinct query types to their respective handlers", async () => {
    const echoStub = sinon.stub().resolves("echo");
    const otherStub = sinon.stub().resolves("other");

    bus.register(EchoQuery, { execute: echoStub });
    bus.register(OtherQuery, { execute: otherStub });

    const [r1, r2] = await Promise.all([
      bus.execute<string>(new EchoQuery("x")),
      bus.execute<string>(new OtherQuery()),
    ]);

    expect(r1).to.equal("echo");
    expect(r2).to.equal("other");
    expect(echoStub.calledOnce).to.be.true;
    expect(otherStub.calledOnce).to.be.true;
  });

  it("throws InternalServerError containing the query type when no handler is registered", async () => {
    const err = await bus.execute(new EchoQuery("x")).catch((e) => e);

    expect(err).to.be.instanceOf(AppError);
    const appError = err as AppError;
    expect(appError.statusCode).to.equal(500);
    expect(appError.message).to.include("EchoQuery");
  });

  it("propagates AppError from handler unchanged, preserving statusCode and message", async () => {
    const notFoundErr = Errors.notFound("User", "uid-1");
    bus.register(EchoQuery, {
      execute: sinon.stub().rejects(notFoundErr),
    });

    const thrown = await bus.execute(new EchoQuery("x")).catch((e) => e);
    expect(thrown).to.equal(notFoundErr);
    const appError = thrown as AppError;
    expect(appError.statusCode).to.equal(404);
  });

  it("dispatches using the .type property so minified constructor names still route correctly", async () => {
    class WrappedQuery implements IQuery {
      readonly type = "EchoQuery" as const;
    }
    Object.defineProperty(WrappedQuery, "name", { value: "q" });

    const stub = sinon.stub().resolves("minified-ok");
    bus.register(EchoQuery, { execute: stub });

    const result = await bus.execute<string>(new WrappedQuery());
    expect(result).to.equal("minified-ok");
  });
});
