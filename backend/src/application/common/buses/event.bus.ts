import { injectable, inject } from "tsyringe";
import { IEventHandler } from "../interfaces/event-handler.interface";
import { IEvent } from "../interfaces/event.interface";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { sessionALS } from "@/database/UnitOfWork";
import { TOKENS } from "@/types/tokens";

@injectable()
export class EventBus {
  private subscriptions: Map<string, unknown[]> = new Map();

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
    handlers.push(handler);
    this.subscriptions.set(eventName, handlers);
  }

  /**
   * Publishes an event immediately, executing all subscribed handlers.
   * @param event - The event instance to be published.
   */
  async publish<TEvent extends IEvent>(event: TEvent): Promise<void> {
    const handlers = (this.subscriptions.get(event.constructor.name) || []) as IEventHandler<TEvent>[];

    await Promise.all(handlers.map((handler) => handler.handle(event)));
  }

  async publishByType(eventType: string, eventPayload: unknown): Promise<void> {
    // Cast to structural handler to pass the unknown payload to its handle method safely
    const handlers = (this.subscriptions.get(eventType) || []) as { handle: (event: unknown) => Promise<void> }[];
    await Promise.all(handlers.map((handler) => handler.handle(eventPayload)));
  }

  /**
   * Persists an event to the outbox within the current UnitOfWork transaction.
   * The OutboxWorker will pick it up and dispatch it to the appropriate subscribed handler.
   * Must be called inside a UnitOfWork.executeInTransaction callback.
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
    );
  }
}
