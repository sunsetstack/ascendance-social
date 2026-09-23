import { expect } from "chai";
import sinon from "sinon";
import { logTerminalError } from "@/utils/terminal-error";
import { errorLogger } from "@/utils/winston";

describe("logTerminalError", () => {
  afterEach(() => sinon.restore());

  it("emits one serialized terminal record with generated identifiers", () => {
    const log = sinon.stub(errorLogger, "error");

    logTerminalError(new Error("worker failed"), {
      event: "worker.example.failed",
      message: "Example worker failed",
      operation: "example_operation",
      worker: "ExampleWorker",
      messageType: "example.message",
      messageId: "safe-message-id",
      attempt: 3,
    });

    sinon.assert.calledOnce(log);
    const [record] = log.firstCall.args as unknown as [
      Record<string, unknown>,
    ];
    expect(record).to.include({
      event: "worker.example.failed",
      message: "Example worker failed",
      operation: "example_operation",
      worker: "ExampleWorker",
      messageType: "example.message",
      messageId: "safe-message-id",
      attempt: 3,
    });
    expect(record.errorId).to.be.a("string");
    expect(record.operationId).to.be.a("string");
    expect(record.error).to.be.instanceOf(Error);
  });
});
