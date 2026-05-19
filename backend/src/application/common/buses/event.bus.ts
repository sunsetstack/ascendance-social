import { randomUUID } from "node:crypto";
import { injectable, inject } from "tsyringe";
import { IEventHandler } from "../interfaces/event-handler.interface";
import { IEvent } from "../interfaces/event.interface";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { sessionALS } from "@/database/UnitOfWork";
import { TOKENS } from "@/types/tokens";
import { getCorrelationId } from "@/runtime/request-context";

type RegisteredEventHandler<TEvent = unknown> = {
  key: string;
  handle: (event: TEvent) => Promise<void>;
};

@injectable()
export class EventBus {
  private subscriptions = new Map<string, RegisteredEventHandler[]>();

  constructor(
    @inject(TOKENS.Repositories.Outbox)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  /**
   * Subscribes a handler to a specific event type.
   * @param eventType - The class constructor of the event type.
   * @param handler - The handler responsible for processing the event.
   */
  subscribe<TEvent extends IEvent>(
    eventType: { new (...args: any[]): TEvent },
    handler: IEventHandler<TEvent>,
  ): void {
    const eventName = eventType.name;
    const handlers = this.subscriptions.get(eventName) || [];
    handlers.push({
      key: this.resolveHandlerKey(handler),
      handle: (event: unknown) => handler.handle(event as TEvent),
    });
    this.subscriptions.set(eventName, handlers);
  }

  /**
   * Publishes an event immediately, executing all subscribed handlers.
   * @param event - The event instance to be published.
   */
  async publish<TEvent extends IEvent>(event: TEvent): Promise<void> {
    const handlers = (this.subscriptions.get(event.constructor.name) || []) as RegisteredEventHandler<TEvent>[];

    await Promise.all(handlers.map((handler) => handler.handle(event)));
  }

  async publishByType(eventType: string, eventPayload: unknown): Promise<void> {
    const handlers = this.getRegisteredHandlers(eventType);
    await Promise.all(handlers.map((handler) => handler.handle(eventPayload)));
  }

  getRegisteredHandlers(eventType: string): RegisteredEventHandler[] {
    return [...(this.subscriptions.get(eventType) || [])];
  }

  /**
   * Persists an event to the outbox within the current UnitOfWork transaction.
   * The OutboxWorker will pick it up and dispatch it to the appropriate subscribed handler.
   * Must be called inside a UnitOfWork.executeInTransaction callback.
   * The generated traceId is an outbox-event correlation ID for async debugging,
   * not a full end-to-end distributed request trace.
   */
  async queueTransactional<TEvent extends IEvent>(
    event: TEvent,
  ): Promise<void> {
    const session = sessionALS.getStore();
    if (!session) {
      throw new Error(
        "queueTransactional must be called within a UnitOfWork transaction context",
      );
    }
    await this.outboxRepository.saveEvent(
      event.constructor.name,
      event,
      randomUUID(),
      getCorrelationId(),
    );
  }

  private resolveHandlerKey(handler: unknown): string {
    if (
      typeof handler === "object" &&
      handler !== null &&
      typeof handler.constructor?.name === "string" &&
      handler.constructor.name !== "Object"
    ) {
      return handler.constructor.name;
    }

    return "anonymous-handler";
  }
}
