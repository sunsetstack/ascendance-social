import { describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { ICommand } from "@/application/common/interfaces/command.interface";
import { IQuery } from "@/application/common/interfaces/query.interface";

class ClassNameDoesNotMatterCommand implements ICommand {
  readonly type = "StableCommandType";

  constructor(public readonly payload: string) {}
}

class ClassNameDoesNotMatterQuery implements IQuery {
  readonly type = "StableQueryType";

  constructor(public readonly page: number) {}
}

describe("CQRS buses", () => {
  it("dispatches commands by explicit type rather than constructor.name", async () => {
    const bus = new CommandBus();
    const handler = {
      execute: sinon.stub().resolves("ok"),
    };
    const command = new ClassNameDoesNotMatterCommand("payload");

    bus.register(ClassNameDoesNotMatterCommand, handler as any);

    const result = await bus.dispatch<string>(command);

    expect(result).to.equal("ok");
    expect(handler.execute.calledOnceWith(command)).to.be.true;
  });

  it("dispatches queries by explicit type rather than constructor.name", async () => {
    const bus = new QueryBus();
    const handler = {
      execute: sinon.stub().resolves({ data: [] }),
    };
    const query = new ClassNameDoesNotMatterQuery(2);

    bus.register(ClassNameDoesNotMatterQuery, handler as any);

    const result = await bus.execute<{ data: unknown[] }>(query);

    expect(result).to.deep.equal({ data: [] });
    expect(handler.execute.calledOnceWith(query)).to.be.true;
  });

  it("uses the explicit command type in missing-handler errors", async () => {
    const bus = new CommandBus();

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
});
