import { OutboxModel, type IOutboxEvent } from "@/models/outbox.model";
import type { HydratedDocument } from "mongoose";
import type { IEvent } from "@/application/common/interfaces/event.interface";
import type { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { OutboxWorker } from "@/workers/outbox.worker";

export class TestEvent implements IEvent {
  readonly type = "TestEvent";
  readonly timestamp = new Date("2026-01-01T00:00:00.000Z");

  constructor(public payload: string) {}
}

export class TestEventHandler implements IEventHandler<TestEvent> {
  async handle(event: TestEvent): Promise<void> {
    void event;
  }
}

export class FirstTestEventHandler extends TestEventHandler {}
export class SecondTestEventHandler extends TestEventHandler {}

export class TestableOutboxWorker extends OutboxWorker {
  async runTick(): Promise<void> {
    await this.tick();
  }
}

type RecordInput = Partial<
  Pick<
    IOutboxEvent,
    | "eventType"
    | "payload"
    | "traceId"
    | "correlationId"
    | "retries"
    | "processedHandlers"
    | "createdAt"
    | "processed"
    | "processing"
    | "processingOwner"
    | "processingStartedAt"
    | "nextAttemptAt"
    | "exhaustedAt"
    | "error"
  >
> & { _id?: string };

export function createRecord(
  input: RecordInput = {},
): HydratedDocument<IOutboxEvent> {
  return new OutboxModel({
    eventType: "TestEvent",
    payload: new TestEvent("test"),
    traceId: "test-trace",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    processed: false,
    processing: false,
    retries: 0,
    processedHandlers: [],
    ...input,
  });
}

export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function nextRecord(): IOutboxEvent {
  return createRecord({
    _id: "507f1f77bcf86cd799439012",
    eventType: "TestEvent",
    payload: new TestEvent("second"),
    retries: 0,
    traceId: "trace-2",
    processedHandlers: [],
  });
}
