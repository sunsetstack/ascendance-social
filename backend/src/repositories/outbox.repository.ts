import { Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IOutboxEvent } from "@/models/outbox.model";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";

@injectable()
export class OutboxRepository extends BaseRepository<IOutboxEvent> {
  constructor(@inject(TOKENS.Models.Outbox) model: Model<IOutboxEvent>) {
    super(model);
  }

  async saveEvent(
    eventType: string,
    payload: any,
    traceId: string,
    correlationId?: string,
  ): Promise<IOutboxEvent> {
    try {
      const session = this.getSession();
      const outboxDocs = await this.model.create(
        [
          {
            eventType,
            payload,
            traceId,
            correlationId,
            processed: false,
            processing: false,
            processedHandlers: [],
          },
        ],
        { session }
      );
      return outboxDocs[0];
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to save outbox event");
    }
  }

  async getUnprocessedEvents(limit: number = 100): Promise<IOutboxEvent[]> {
    try {
      return await this.model
        .find({ processed: false, retries: { $lt: 5 } })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to fetch unprocessed events");
    }
  }

  async claimPendingEvents(
    limit: number,
    workerId: string,
    staleAfterMs: number,
  ): Promise<IOutboxEvent[]> {
    try {
      const claimed: IOutboxEvent[] = [];
      const staleBefore = new Date(Date.now() - staleAfterMs);

      while (claimed.length < limit) {
        const nextEvent = await this.model
          .findOneAndUpdate(
            {
              processed: false,
              retries: { $lt: 5 },
              $or: [
                { processing: { $ne: true } },
                { processingStartedAt: { $exists: false } },
                { processingStartedAt: { $lt: staleBefore } },
              ],
            },
            {
              $set: {
                processing: true,
                processingOwner: workerId,
                processingStartedAt: new Date(),
              },
            },
            {
              sort: { createdAt: 1 },
              new: true,
            },
          )
          .exec();

        if (!nextEvent) {
          break;
        }

        claimed.push(nextEvent);
      }

      return claimed;
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to claim pending outbox events");
    }
  }

  async countPendingEvents(): Promise<number> {
    try {
      return await this.model
        .countDocuments({ processed: false, retries: { $lt: 5 } })
        .exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to count pending outbox events");
    }
  }

  async markAsProcessed(eventId: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: eventId },
        {
          $set: {
            processed: true,
            processedAt: new Date(),
            processing: false,
          },
          $unset: {
            processingOwner: 1,
            processingStartedAt: 1,
            error: 1,
          },
        }
      ).exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to mark event as processed");
    }
  }

  async markHandlerProcessed(eventId: string, handlerKey: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: eventId },
        { $addToSet: { processedHandlers: handlerKey } }
      ).exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to mark handler as processed");
    }
  }

  async markAsFailed(eventId: string, errorMessage: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: eventId },
        { 
          $inc: { retries: 1 }, 
          $set: { error: errorMessage, processing: false }, 
          $unset: { processingOwner: 1, processingStartedAt: 1 },
        }
      ).exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to mark event as failed");
    }
  }
}
