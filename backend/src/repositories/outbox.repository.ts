import { Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IOutboxEvent } from "@/models/outbox.model";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { EventRegistry } from "@/application/common/events/event-registry";

const DEFAULT_MAX_OUTBOX_ATTEMPTS = 5;
const configuredMaxOutboxAttempts = Number(
  process.env.OUTBOX_MAX_ATTEMPTS,
);

export const MAX_OUTBOX_RETRIES =
  Number.isSafeInteger(configuredMaxOutboxAttempts) &&
  configuredMaxOutboxAttempts > 0
    ? configuredMaxOutboxAttempts
    : DEFAULT_MAX_OUTBOX_ATTEMPTS;

export interface OutboxBacklogStats {
  pendingCount: number;
  exhaustedCount: number;
  oldestPendingAt?: Date;
}

export interface OutboxFailureState {
  nextAttemptAt?: Date;
  exhaustedAt?: Date;
}

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
      const eventPayload = this.preparePayload(eventType, payload, traceId);
      const outboxDocs = await this.model.create(
        [
          {
            eventType,
            payload: eventPayload,
            traceId,
            correlationId,
            processed: false,
            processing: false,
            processedHandlers: [],
          },
        ],
        { session },
      );
      return outboxDocs[0];
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to save outbox event",
      );
    }
  }

  async getUnprocessedEvents(limit: number = 100): Promise<IOutboxEvent[]> {
    try {
      const now = new Date();
      return await this.model
        .find({
          processed: false,
          retries: { $lt: MAX_OUTBOX_RETRIES },
          exhaustedAt: { $exists: false },
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec();
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to fetch unprocessed events",
      );
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
      const now = new Date();

      while (claimed.length < limit) {
        const nextEvent = await this.model
          .findOneAndUpdate(
            {
              processed: false,
              retries: { $lt: MAX_OUTBOX_RETRIES },
              exhaustedAt: { $exists: false },
              $and: [
                {
                  $or: [
                    { nextAttemptAt: { $exists: false } },
                    { nextAttemptAt: { $lte: now } },
                  ],
                },
                {
                  $or: [
                    { processing: { $ne: true } },
                    { processingStartedAt: { $exists: false } },
                    { processingStartedAt: { $lt: staleBefore } },
                  ],
                },
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
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to claim pending outbox events",
      );
    }
  }

  async countPendingEvents(): Promise<number> {
    try {
      return await this.model
        .countDocuments({
          processed: false,
          retries: { $lt: MAX_OUTBOX_RETRIES },
          exhaustedAt: { $exists: false },
        })
        .exec();
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to count pending outbox events",
      );
    }
  }

  async getBacklogStats(): Promise<OutboxBacklogStats> {
    try {
      const [result] = await this.model
        .aggregate<{
          pending: Array<{ count: number; oldestPendingAt?: Date }>;
          exhausted: Array<{ count: number }>;
        }>([
          { $match: { processed: false } },
          {
            $facet: {
              pending: [
                {
                  $match: {
                    retries: { $lt: MAX_OUTBOX_RETRIES },
                    exhaustedAt: { $exists: false },
                  },
                },
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    oldestPendingAt: { $min: "$createdAt" },
                  },
                },
              ],
              exhausted: [
                {
                  $match: {
                    $or: [
                      { retries: { $gte: MAX_OUTBOX_RETRIES } },
                      { exhaustedAt: { $exists: true } },
                    ],
                  },
                },
                { $count: "count" },
              ],
            },
          },
        ])
        .exec();

      return {
        pendingCount: result?.pending[0]?.count ?? 0,
        exhaustedCount: result?.exhausted[0]?.count ?? 0,
        oldestPendingAt: result?.pending[0]?.oldestPendingAt,
      };
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to inspect outbox backlog",
      );
    }
  }

  async markAsProcessed(
    eventId: string,
    workerId?: string,
  ): Promise<boolean> {
    try {
      const result = await this.model
        .updateOne(
          this.buildOwnedFilter(eventId, workerId),
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
              nextAttemptAt: 1,
              exhaustedAt: 1,
            },
          },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to mark event as processed",
      );
    }
  }

  async markHandlerProcessed(
    eventId: string,
    handlerKey: string,
    workerId?: string,
  ): Promise<boolean> {
    try {
      const result = await this.model
        .updateOne(
          this.buildOwnedFilter(eventId, workerId),
          { $addToSet: { processedHandlers: handlerKey } },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to mark handler as processed",
      );
    }
  }

  async markAsFailed(
    eventId: string,
    errorMessage: string,
    workerId?: string,
    failureState: OutboxFailureState = {},
  ): Promise<boolean> {
    try {
      const fieldsToSet: Record<string, unknown> = {
        error: errorMessage,
        processing: false,
      };
      const fieldsToUnset: Record<string, 1> = {
        processingOwner: 1,
        processingStartedAt: 1,
      };

      if (failureState.exhaustedAt) {
        fieldsToSet.exhaustedAt = failureState.exhaustedAt;
        fieldsToUnset.nextAttemptAt = 1;
      } else if (failureState.nextAttemptAt) {
        fieldsToSet.nextAttemptAt = failureState.nextAttemptAt;
        fieldsToUnset.exhaustedAt = 1;
      }

      const result = await this.model
        .updateOne(
          this.buildOwnedFilter(eventId, workerId),
          {
            $inc: { retries: 1 },
            $set: fieldsToSet,
            $unset: fieldsToUnset,
          },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to mark event as failed",
      );
    }
  }

  async requeueExhaustedEvent(eventId: string): Promise<boolean> {
    try {
      const result = await this.model
        .updateOne(
          {
            _id: eventId,
            processed: false,
            processing: { $ne: true },
            $or: [
              { retries: { $gte: MAX_OUTBOX_RETRIES } },
              { exhaustedAt: { $exists: true } },
            ],
          },
          {
            $set: {
              retries: 0,
              processing: false,
            },
            $unset: {
              error: 1,
              exhaustedAt: 1,
              nextAttemptAt: 1,
              processingOwner: 1,
              processingStartedAt: 1,
            },
          },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to requeue exhausted outbox event",
      );
    }
  }

  async renewClaim(eventId: string, workerId: string): Promise<boolean> {
    const result = await this.model.updateOne(
      { _id: eventId, processingOwner: workerId, processing: true, processed: false },
      { $set: { processingStartedAt: new Date() } },
    ).exec();
    return result.matchedCount === 1;
  }

  private buildOwnedFilter(
    eventId: string,
    workerId?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = { _id: eventId };
    if (workerId) {
      filter.processingOwner = workerId;
    }
    return filter;
  }

  private preparePayload(
    eventType: string,
    payload: any,
    traceId: string,
  ): any {
    if (
      eventType !== EventRegistry.domain.NotificationRequested ||
      !payload?.payload ||
      payload.payload.idempotencyKey
    ) {
      return payload;
    }

    return {
      ...payload,
      payload: {
        ...payload.payload,
        idempotencyKey: `notification:${traceId}`,
      },
    };
  }
}
