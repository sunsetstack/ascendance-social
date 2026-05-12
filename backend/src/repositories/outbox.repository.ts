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
  ): Promise<IOutboxEvent> {
    try {
      const session = this.getSession();
      const outboxDocs = await this.model.create(
        [
          {
            eventType,
            payload,
            processed: false,
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

  async markAsProcessed(eventId: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: eventId },
        { $set: { processed: true, processedAt: new Date() } }
      ).exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to mark event as processed");
    }
  }

  async markAsFailed(eventId: string, errorMessage: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: eventId },
        { 
          $inc: { retries: 1 }, 
          $set: { error: errorMessage } 
        }
      ).exec();
    } catch (error: unknown) {
      throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to mark event as failed");
    }
  }
}
