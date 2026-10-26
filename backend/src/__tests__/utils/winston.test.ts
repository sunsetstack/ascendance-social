import { expect } from "chai";
import { describe, it } from "mocha";
import { Writable } from "node:stream";
import winston from "winston";
import {
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";
import {
  createConsoleLogFormat,
  createLogContractFormat,
  createJsonLogFormat,
  MAX_LOG_ARRAY_ITEMS,
  MAX_LOG_METADATA_DEPTH,
  MAX_LOG_OBJECT_ENTRIES,
  MAX_LOG_ROOT_MESSAGE_LENGTH,
  MAX_LOG_STRING_LENGTH,
} from "@/utils/winston";

type TestLogInfo = Record<string | symbol, unknown>;

function transform(info: TestLogInfo): TestLogInfo {
  const format = createLogContractFormat();
  return format.transform(info as never, {}) as unknown as TestLogInfo;
}

class MemoryLogStream extends Writable {
  public readonly lines: string[] = [];

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(chunk.toString());
    callback();
  }
}

describe("Winston log contract format", () => {
  it("bounds and redacts a 1 MB root message", () => {
    const result = transform({
      level: "info",
      message: `Bearer root-secret ${"x".repeat(1_000_000)}`,
    });

    expect(result.message).to.be.a("string");
    expect((result.message as string).length).to.equal(
      MAX_LOG_ROOT_MESSAGE_LENGTH,
    );
    expect(result.message).to.include("[Truncated]");
    expect(result.message).not.to.include("root-secret");
  });

  it("converts a non-string root object message into a bounded safe string", () => {
    const result = transform({
      level: "info",
      message: { token: "root-secret", operation: "widget.read" },
    });

    expect(result.message).to.be.a("string");
    expect(result.message).to.include("widget.read");
    expect(result.message).not.to.include("root-secret");
  });

  it("converts bigint and symbol root messages into safe strings", () => {
    const bigint = transform({ level: "info", message: 123n });
    const symbol = transform({ level: "info", message: Symbol("message") });

    expect(bigint.message).to.equal("123");
    expect(symbol.message).to.equal("Symbol(message)");
  });

  it("serializes an Error root message without using it as the transport message", () => {
    const result = transform({
      level: "error",
      message: new Error("root failure", { cause: new Error("inner failure") }),
    });

    expect(result.message).to.equal("root failure");
    expect(
      (result.error as { cause?: { message?: string } }).cause?.message,
    ).to.equal("inner failure");
  });

  it("replaces a throwing root-message getter with a safe message", () => {
    const info = Object.defineProperty({ level: "info" }, "message", {
      enumerable: true,
      get(): never {
        throw new Error("message getter failed");
      },
    });
    const result = transform(info as unknown as TestLogInfo);

    expect(result.message).to.equal("[Unserializable]");
  });

  it("replaces a hostile root-message Proxy with a safe message", () => {
    const message = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error("message ownKeys failed");
        },
      },
    );
    const result = transform({ level: "info", message });

    expect(result.message).to.equal("[Unserializable]");
  });

  it("bounds and redacts a 1 MB nested string", () => {
    const result = transform({
      level: "info",
      message: "request completed",
      details: `token=nested-secret ${"x".repeat(1_000_000)}`,
    });

    expect(result.details).to.be.a("string");
    expect((result.details as string).length).to.equal(MAX_LOG_STRING_LENGTH);
    expect(result.details).to.include("[Truncated]");
    expect(result.details).not.to.include("nested-secret");
  });

  it("bounds a 100,000-item array without mutating it", () => {
    const values = Array.from({ length: 100_000 }, (_, index) => index);
    const result = transform({
      level: "info",
      message: "request completed",
      values,
    });

    expect(result.values).to.deep.equal([
      ...values.slice(0, MAX_LOG_ARRAY_ITEMS),
      "[Truncated]",
    ]);
    expect(values).to.have.length(100_000);
  });

  it("bounds object entries with a truncation marker", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: MAX_LOG_OBJECT_ENTRIES + 1 }, (_, index) => [
        `field${index}`,
        index,
      ]),
    );
    const result = transform({
      level: "info",
      message: "request completed",
      metadata,
    });

    const sanitized = result.metadata as Record<string, unknown>;
    expect(Object.keys(sanitized)).to.have.length(MAX_LOG_OBJECT_ENTRIES + 1);
    expect(sanitized["[Truncated]"]).to.equal(true);
    expect(sanitized.field0).to.equal(0);
  });

  it("bounds deeply nested metadata", () => {
    const metadata = { a: { b: { c: { d: { value: "not inspected" } } } } };
    const result = transform({
      level: "info",
      message: "request completed",
      metadata,
    });

    let value: unknown = result.metadata;
    for (let index = 0; index < MAX_LOG_METADATA_DEPTH; index += 1) {
      value = (value as Record<string, unknown>)[["a", "b", "c", "d"][index]];
    }
    expect(value).to.equal("[MaxDepth]");
  });

  it("marks circular metadata without retaining the caller object", () => {
    const metadata: Record<string, unknown> = { id: "metadata-123" };
    metadata.self = metadata;
    const result = transform({
      level: "info",
      message: "request completed",
      metadata,
    });

    const sanitized = result.metadata as Record<string, unknown>;
    expect(sanitized).not.to.equal(metadata);
    expect(sanitized.self).to.equal("[Circular]");
  });

  it("does not throw for a Proxy whose ownKeys trap throws", () => {
    const metadata = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error("ownKeys failed");
        },
      },
    );

    let result: TestLogInfo | undefined;
    expect(() => {
      result = transform({
        level: "info",
        message: "request completed",
        metadata,
      });
    }).not.to.throw();
    expect(result?.metadata).to.equal("[Unserializable]");
  });

  it("does not throw for a Proxy whose get trap throws", () => {
    const metadata = new Proxy(
      { value: "secret" },
      {
        get(): never {
          throw new Error("get failed");
        },
      },
    );

    let result: TestLogInfo | undefined;
    expect(() => {
      result = transform({
        level: "info",
        message: "request completed",
        metadata,
      });
    }).not.to.throw();
    expect(result?.metadata).to.deep.equal({ value: "[Unserializable]" });
  });

  it("does not invoke a throwing metadata getter", () => {
    const metadata = Object.defineProperty({}, "value", {
      enumerable: true,
      get(): never {
        throw new Error("getter failed");
      },
    });
    const result = transform({
      level: "info",
      message: "request completed",
      metadata,
    });

    expect((result.metadata as Record<string, unknown>).value).to.equal(
      "[Unserializable]",
    );
  });

  it("does not invoke a throwing toString method", () => {
    const metadata = {
      value: "safe",
      toString(): never {
        throw new Error("toString failed");
      },
    };

    let result: TestLogInfo | undefined;
    expect(() => {
      result = transform({
        level: "info",
        message: "request completed",
        metadata,
      });
    }).not.to.throw();
    expect(result?.metadata).to.deep.equal({
      value: "safe",
      toString: "[Function]",
    });
  });

  it("serializes a normal Error with its nested cause", () => {
    const error = new Error("outer failure", {
      cause: new Error("inner failure"),
    });
    const result = transform({
      level: "error",
      message: "request failed",
      error,
    });

    const serialized = result.error as {
      cause?: { message?: string };
      message?: string;
    };
    expect(serialized.message).to.equal("outer failure");
    expect(serialized.cause?.message).to.equal("inner failure");
  });

  it("uses the bounded Error serializer for a circular Error cause", () => {
    const error = new Error("circular failure") as Error & { cause: Error };
    error.cause = error;
    const result = transform({
      level: "error",
      message: "request failed",
      error,
    });

    expect(JSON.stringify(result.error)).to.include("Circular");
  });

  it("redacts sensitive nested metadata", () => {
    const result = transform({
      level: "info",
      message: "request completed",
      metadata: {
        password: "nested-password",
        request: { authorization: "Bearer nested-token" },
      },
    });

    const serialized = JSON.stringify(result.metadata);
    expect(serialized).to.include("[REDACTED]");
    expect(serialized).not.to.include("nested-password");
    expect(serialized).not.to.include("nested-token");
  });

  it("does not retain a non-writable top-level sensitive value", () => {
    const info: TestLogInfo = {
      level: "info",
      message: "request completed",
    };

    Object.defineProperty(info, "password", {
      configurable: false,
      enumerable: true,
      value: "top-level-secret",
      writable: false,
    });
    const result = transform(info);

    expect(result.password).to.equal("[REDACTED]");
    expect(info.password).to.equal("top-level-secret");
  });

  it("does not retain a non-writable top-level huge value", () => {
    const hugeValue = "x".repeat(1_000_000);
    const info: TestLogInfo = {
      level: "info",
      message: "request completed",
    };

    Object.defineProperty(info, "details", {
      configurable: false,
      enumerable: true,
      value: hugeValue,
      writable: false,
    });
    const result = transform(info);

    expect(result.details).to.be.a("string");
    expect((result.details as string).length).to.equal(MAX_LOG_STRING_LENGTH);
    expect(result.details).to.include("[Truncated]");
    expect(info.details).to.equal(hugeValue);
  });

  it("survives a top-level correlationId getter that throws", () => {
    const info = Object.defineProperty(
      { level: "info", message: "request completed" },
      "correlationId",
      {
        enumerable: true,
        get(): never {
          throw new Error("correlation getter failed");
        },
      },
    );
    const result = transform(info);

    expect(result.correlationId).to.equal("[Unserializable]");
  });

  it("returns a minimal safe envelope for a hostile top-level info Proxy", () => {
    const info = new Proxy(
      {},
      {
        get(): never {
          throw new Error("top-level get failed");
        },
        ownKeys(): string[] {
          throw new Error("top-level ownKeys failed");
        },
      },
    );
    const result = transform(info as unknown as TestLogInfo);

    expect(result.level).to.equal("info");
    expect(result.message).to.equal("[Unserializable]");
    expect(result["[Unserializable]"]).to.equal(true);
  });

  it("renders a bounded fallback through the complete console format chain", () => {
    const format = createConsoleLogFormat();
    const message = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error("console root ownKeys failed");
        },
      },
    );
    const result = format.transform(
      { level: "info", message } as never,
      {},
    ) as unknown as TestLogInfo;

    expect(result[Symbol.for("message")]).to.be.a("string");
    expect(result[Symbol.for("message")]).to.include("[Unserializable]");
  });

  it("does not rely on replacing a top-level accessor-only property", () => {
    const info = Object.defineProperty(
      { level: "info", message: "request completed" },
      "details",
      {
        enumerable: true,
        get(): string {
          return "accessor value";
        },
      },
    );
    const result = transform(info);

    expect(result.details).to.equal("accessor value");
    expect(Object.getOwnPropertyDescriptor(info, "details")?.set).to.be
      .undefined;
  });

  it("preserves Winston transport symbol fields", () => {
    const level = Symbol.for("level");
    const message = Symbol.for("message");
    const splat = Symbol.for("splat");
    const splatValue = { interpolation: "preserved" };
    const result = transform({
      level: "info",
      message: "request completed",
      [level]: "info",
      [message]: "preformatted message",
      [splat]: splatValue,
    });

    expect(result[level]).to.equal("info");
    expect(result[message]).to.equal("preformatted message");
    expect(result[splat]).to.equal(splatValue);
  });

  it("keeps normal small metadata readable without mutating it", () => {
    const metadata = {
      attempts: 2,
      nested: { enabled: true, label: "worker" },
      tags: ["cache", "read"],
    };
    const result = transform({
      level: "info",
      message: "request completed",
      metadata,
    });

    expect(result.metadata).to.deep.equal(metadata);
    expect(result.metadata).not.to.equal(metadata);
    expect(metadata).to.deep.equal({
      attempts: 2,
      nested: { enabled: true, label: "worker" },
      tags: ["cache", "read"],
    });
  });

  it("writes one JSON line per record through the real combined transport path", async () => {
    const stream = new MemoryLogStream();
    const logger = winston.createLogger({
      format: createJsonLogFormat(),
      transports: [new winston.transports.Stream({ stream })],
    });
    const nonWritableInfo = Object.defineProperty(
      {
        level: "info",
        message: "non-writable metadata",
      },
      "password",
      {
        configurable: false,
        enumerable: true,
        value: "transport-secret",
        writable: false,
      },
    );

    try {
      logger.info("normal record", { event: "widget.read" });
      logger.info("nested hostile metadata", {
        metadata: new Proxy(
          {},
          {
            ownKeys(): string[] {
              throw new Error("nested ownKeys failed");
            },
          },
        ),
      });
      logger.log({
        level: "info",
        message: new Error("root transport failure"),
      } as never);
      logger.log(nonWritableInfo as never);

      await new Promise<void>((resolve) => {
        logger.once("finish", () => resolve());
        logger.end();
      });

      expect(stream.lines).to.have.length(4);
      const lines = stream.lines.map((line) => JSON.parse(line));
      expect(lines[0]).to.include({
        event: "widget.read",
        message: "normal record",
      });
      expect(lines[1].metadata).to.equal("[Unserializable]");
      expect(lines[2]).to.include({ message: "root transport failure" });
      expect(lines[2].error.cause).to.be.undefined;
      expect(lines[3].password).to.equal("[REDACTED]");
      expect(JSON.stringify(lines)).not.to.include("transport-secret");
    } finally {
      logger.close();
    }
  });

  it("redacts ALS user identity while retaining request and action ancestry in JSON output", async () => {
    const stream = new MemoryLogStream();
    const logger = winston.createLogger({
      format: createJsonLogFormat(),
      transports: [new winston.transports.Stream({ stream })],
    });
    const userId = "private-user-123";
    const correlationId = "correlation-123";

    try {
      await runWithRequestContext({ correlationId, userId, clientRequestId: "browser-action", causedByClientRequestId: "earlier-action" }, async () => {
        logger.info("context record");
        await new Promise<void>((resolve) => {
          logger.once("finish", () => resolve());
          logger.end();
        });
      });

      expect(stream.lines).to.have.length(1);
      const line = JSON.parse(stream.lines[0]);
      expect(line.correlationId).to.equal(correlationId);
      expect(line.clientRequestId).to.equal("browser-action");
      expect(line.causedByClientRequestId).to.equal("earlier-action");
      expect(line.userId).to.equal("[REDACTED]");
      expect(JSON.stringify(line)).not.to.include(userId);
    } finally {
      logger.close();
    }
  });

  it("does not inspect a throwing sensitive request-context getter", () => {
    let userIdRead = false;

    runWithRequestContext({ correlationId: "context-123" }, () => {
      const context = getRequestContext() as Record<string, unknown>;
      Object.defineProperty(context, "userId", {
        configurable: true,
        enumerable: true,
        get(): never {
          userIdRead = true;
          throw new Error("user ID getter must not run");
        },
      });
      const format = createJsonLogFormat();
      const result = format.transform(
        { level: "info", message: "context record" } as never,
        {},
      ) as unknown as TestLogInfo;

      expect(result.userId).to.equal("[REDACTED]");
    });

    expect(userIdRead).to.equal(false);
  });

  it("does not expose ALS user identity through the complete console format", () => {
    const userId = "private-console-user";

    runWithRequestContext(
      { correlationId: "console-correlation", userId },
      () => {
        const format = createConsoleLogFormat();
        const result = format.transform(
          { level: "info", message: "console context record" } as never,
          {},
        ) as unknown as TestLogInfo;
        const line = result[Symbol.for("message")] as string;

        expect(line).to.include("console-correlation");
        expect(line).to.include("[REDACTED]");
        expect(line).not.to.include(userId);
      },
    );
  });
});
