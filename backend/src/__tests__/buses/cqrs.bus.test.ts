import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { CommandBus } from "@/application/common/buses/command.bus";
import { EventBus } from "@/application/common/buses/event.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import type {
  CommandHandlers,
  HandlerDefinition,
  QueryHandlers,
} from "@/application/common/buses/bus-contracts";
import { RecordPostViewCommand } from "@/application/commands/post/recordPostView/recordPostView.command";
import { CheckFollowStatusQuery } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.query";
import { ICommand } from "@/application/common/interfaces/command.interface";
import type { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { IQuery } from "@/application/common/interfaces/query.interface";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import {
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";

class ClassNameDoesNotMatterCommand implements ICommand {
  static readonly type = "StableCommandType";
  readonly type = "StableCommandType";

  constructor(public readonly payload: string) {}
}

class ClassNameDoesNotMatterQuery implements IQuery {
  static readonly type = "StableQueryType";
  readonly type = "StableQueryType";

  constructor(public readonly page: number) {}
}

class StaticTypeOnlyCommand implements ICommand {
  static readonly type = "StaticTypeOnlyCommand";
  readonly type = StaticTypeOnlyCommand.type;

  constructor(_payload: string) {
    throw new Error("Command constructor should not be invoked during register()");
  }
}

class StaticTypeOnlyQuery implements IQuery {
  static readonly type = "StaticTypeOnlyQuery";
  readonly type = StaticTypeOnlyQuery.type;

  constructor(_page: number) {
    throw new Error("Query constructor should not be invoked during register()");
  }
}

type TestCommandHandlers =
  | ICommandHandler<ClassNameDoesNotMatterCommand, string>
  | ICommandHandler<StaticTypeOnlyCommand, string>;

type TestQueryHandlers =
  | IQueryHandler<ClassNameDoesNotMatterQuery, { data: unknown[] }>
  | IQueryHandler<StaticTypeOnlyQuery, { data: unknown[] }>;

function assertBusContracts(
  commandBus: CommandBus,
  queryBus: QueryBus,
  command: RecordPostViewCommand,
  query: CheckFollowStatusQuery,
): void {
  const recorded: Promise<boolean> = commandBus.dispatch(command);
  const following: Promise<boolean> = queryBus.execute(query);
  void recorded;
  void following;

  // @ts-expect-error The command's result is boolean.
  const wrongCommandResult: Promise<string> = commandBus.dispatch(command);
  // @ts-expect-error The query's result is boolean.
  const wrongQueryResult: Promise<string> = queryBus.execute(query);
  void wrongCommandResult;
  void wrongQueryResult;

  // @ts-expect-error Callers cannot select an independent command result type.
  commandBus.dispatch<boolean>(command);
  // @ts-expect-error Callers cannot select an independent query result type.
  queryBus.execute<boolean>(query);

  // @ts-expect-error The handler must return the command's boolean result.
  commandBus.register(RecordPostViewCommand, { execute: async () => "wrong" });
  // @ts-expect-error The handler must return the query's boolean result.
  queryBus.register(CheckFollowStatusQuery, { execute: async () => "wrong" });

  class WrongResultHandler {
    async execute(): Promise<string> {
      return "wrong";
    }
  }

  // @ts-expect-error DI registrations must preserve the command/result pair.
  const wrongCommandDefinition: HandlerDefinition<CommandHandlers> = [RecordPostViewCommand, "wrong-command", WrongResultHandler];
  // @ts-expect-error DI registrations must preserve the query/result pair.
  const wrongQueryDefinition: HandlerDefinition<QueryHandlers> = [CheckFollowStatusQuery, "wrong-query", WrongResultHandler];
  void wrongCommandDefinition;
  void wrongQueryDefinition;
}

class ClassNameDoesNotMatterEvent implements IEvent {
  static readonly type = "StableEventType";
  readonly type = ClassNameDoesNotMatterEvent.type;
  readonly timestamp = new Date();
}

describe("CQRS buses", () => {
  it("dispatches commands by explicit type rather than constructor.name", async () => {
    const bus = new CommandBus<TestCommandHandlers>();
    const handler = {
      execute: sinon.stub().resolves("ok"),
    };
    const command = new ClassNameDoesNotMatterCommand("payload");

    bus.register(ClassNameDoesNotMatterCommand, handler);

    const result = await bus.dispatch(command);

    expect(result).to.equal("ok");
    expect(handler.execute.calledOnceWith(command)).to.be.true;
  });

  it("dispatches queries by explicit type rather than constructor.name", async () => {
    const bus = new QueryBus<TestQueryHandlers>();
    const handler = {
      execute: sinon.stub().resolves({ data: [] }),
    };
    const query = new ClassNameDoesNotMatterQuery(2);

    bus.register(ClassNameDoesNotMatterQuery, handler);

    const result = await bus.execute(query);

    expect(result).to.deep.equal({ data: [] });
    expect(handler.execute.calledOnceWith(query)).to.be.true;
  });

  it("publishes and persists events by explicit type", async () => {
    const saveEvent = sinon.stub().resolves();
    const recordDomainEventPublished = sinon.stub();
    const bus = new EventBus(
      { saveEvent } as any,
      { recordDomainEventPublished } as any,
    );
    const handler = {
      handle: sinon.stub().resolves(),
    };
    const event = new ClassNameDoesNotMatterEvent();

    bus.subscribe(ClassNameDoesNotMatterEvent, handler);
    await bus.publish(event);
    await bus.queueDurable(event);

    expect(handler.handle.calledOnceWith(event)).to.be.true;
    expect(saveEvent.firstCall.args[0]).to.equal("StableEventType");
    expect(
      recordDomainEventPublished.calledWith(
        "StableEventType",
        "immediate",
      ),
    ).to.be.true;
    expect(
      recordDomainEventPublished.calledWith(
        "StableEventType",
        "durable_outbox",
      ),
    ).to.be.true;
  });

  it("orders handler breadcrumbs and rethrows the original command error", async () => {
    const bus = new CommandBus<TestCommandHandlers>();
    const failure = new Error("handler failed");
    const handler = {
      execute: sinon.stub().rejects(failure),
    };
    bus.register(ClassNameDoesNotMatterCommand, handler);

    await runWithRequestContext({ correlationId: "command-123" }, async () => {
      try {
        await bus.dispatch(new ClassNameDoesNotMatterCommand("payload"));
        expect.fail("Expected dispatch() to throw");
      } catch (error) {
        expect(error).to.equal(failure);
      }

      expect(getRequestContext()?.breadcrumbs.map(({ event }) => event)).to.deep.equal([
        "cqrs.command.dispatch",
        "cqrs.command.handler.enter",
        "cqrs.command.handler.failed",
      ]);
    });
  });

  it("orders query breadcrumbs and rethrows the original query error", async () => {
    const bus = new QueryBus<TestQueryHandlers>();
    const failure = new Error("query failed");
    const handler = {
      execute: sinon.stub().rejects(failure),
    };
    bus.register(ClassNameDoesNotMatterQuery, handler);

    await runWithRequestContext({ correlationId: "query-123" }, async () => {
      try {
        await bus.execute(new ClassNameDoesNotMatterQuery(1));
        expect.fail("Expected execute() to throw");
      } catch (error) {
        expect(error).to.equal(failure);
      }

      expect(getRequestContext()?.breadcrumbs.map(({ event }) => event)).to.deep.equal([
        "cqrs.query.dispatch",
        "cqrs.query.handler.enter",
        "cqrs.query.handler.failed",
      ]);
    });
  });

  it("uses the explicit command type in missing-handler errors", async () => {
    const bus = new CommandBus<TestCommandHandlers>();

    try {
      await bus.dispatch(new ClassNameDoesNotMatterCommand("payload"));
      expect.fail("Expected dispatch() to throw");
    } catch (error: any) {
      expect(error.name).to.equal("InternalServerError");
      expect(error.message).to.equal(
        "No handler found for command StableCommandType",
      );
    }
  });

  it("registers commands without constructing them when a static type is present", () => {
    const bus = new CommandBus<TestCommandHandlers>();
    const handler = {
      execute: sinon.stub().resolves("ok"),
    };

    expect(() => bus.register(StaticTypeOnlyCommand, handler)).to.not.throw();
  });

  it("registers queries without constructing them when a static type is present", () => {
    const bus = new QueryBus<TestQueryHandlers>();
    const handler = {
      execute: sinon.stub().resolves({ data: [] }),
    };

    expect(() => bus.register(StaticTypeOnlyQuery, handler)).to.not.throw();
  });
});
