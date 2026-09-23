import { randomUUID } from "node:crypto";
import { injectable, inject } from "tsyringe";
import { IEventHandler } from "../interfaces/event-handler.interface";
import { IEvent } from "../interfaces/event.interface";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { requireTransactionSession } from "@/database/UnitOfWork";
import { TOKENS } from "@/types/tokens";
import { getCorrelationId } from "@/runtime/request-context";
import type {
  EventPayloadRegistry,
  RegisteredEventType,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

type RegisteredEventHandler<TEvent = unknown> = {
  key: string;
  handle: (event: TEvent) => Promise<void>;
};

type EventClass<TEvent extends IEvent> = {
  new (...args: any[]): TEvent;
  readonly type?: TEvent["type"];
};

@injectable()
export class EventBus {
  private subscriptions = new Map<string, RegisteredEventHandler[]>();

  constructor(
    @inject(TOKENS.Repositories.Outbox)
    private readonly outboxRepository: OutboxRepository,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Subscribes a handler to a specific event type.
   * @param eventType - The class constructor of the event type.
   * @param handler - The handler responsible for processing the event.
   */
  subscribe<TEvent extends IEvent>(
    eventType: EventClass<TEvent>,
    handler: IEventHandler<TEvent>,
  ): void {
    const eventName = this.resolveEventType(eventType);
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
    const handlers = (this.subscriptions.get(event.type) ||
      []) as RegisteredEventHandler<TEvent>[];

    await Promise.all(handlers.map((handler) => handler.handle(event)));
    this.metricsService.recordDomainEventPublished(event.type, "immediate");
  }

  async publishByType<TEventType extends string>(
    eventType: TEventType,
    eventPayload: TEventType extends RegisteredEventType
      ? EventPayloadRegistry[TEventType]
      : unknown,
  ): Promise<void> {
    const handlers = this.getRegisteredHandlers(eventType);
    await Promise.all(handlers.map((handler) => handler.handle(eventPayload)));
    this.metricsService.recordDomainEventPublished(eventType, "immediate");
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
    requireTransactionSession(
      "queueTransactional must be called within a UnitOfWork transaction context",
    );
    await this.outboxRepository.saveEvent(
      event.type,
      event,
      randomUUID(),
      getCorrelationId(),
    );
    this.metricsService.recordDomainEventPublished(
      event.type,
      "transactional_outbox",
    );
  }

  async queueDurable<TEvent extends IEvent>(event: TEvent): Promise<void> {
    await this.outboxRepository.saveEvent(
      event.type,
      event,
      randomUUID(),
      getCorrelationId(),
    );
    this.metricsService.recordDomainEventPublished(
      event.type,
      "durable_outbox",
    );
  }

  private resolveEventType<TEvent extends IEvent>(
    eventType: EventClass<TEvent>,
  ): string {
    if (typeof eventType.type === "string" && eventType.type.length > 0) {
      return eventType.type;
    }

    const constructorName = (eventType as { name?: unknown }).name;
    if (typeof constructorName === "string" && constructorName.length > 0) {
      return constructorName;
    }

    throw new Error("Could not resolve event type for constructor");
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
