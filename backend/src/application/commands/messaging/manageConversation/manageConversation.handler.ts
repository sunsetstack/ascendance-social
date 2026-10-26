import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { performance } from "node:perf_hooks";
import { MetricsService } from "@/metrics/metrics.service";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import { logger } from "@/utils/winston";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EventBus } from "@/application/common/buses/event.bus";
import { ConversationsChangedEvent } from "@/application/events/message/message.event";
import { UnitOfWork } from "@/database/UnitOfWork";
import { ConversationRepository } from "@/repositories/conversation.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { TOKENS } from "@/types/tokens";
import { getParticipantIds } from "@/utils/messaging-helpers";
import { Errors } from "@/utils/errors";
import { resolveParticipantPublicIds } from "@/application/messaging/messaging-support";
import { ManageConversationCommand } from "./manageConversation.command";

@injectable()
export class ManageConversationCommandHandler implements ICommandHandler<
  ManageConversationCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversations: ConversationRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Metrics) private readonly metrics: MetricsService,
  ) {}

  async execute(command: ManageConversationCommand): Promise<void> {
    const started = performance.now();
    try {
      let requestLogIds: string[] = [];
      if (command.action === "purge") {
        const user = await this.users.findByPublicId(command.userPublicId);
        if (!user?.isAdmin || user.isBanned)
          throw Errors.forbidden("Admin privileges required");
        requestLogIds = await this.conversations.findRequestLogIds(
          command.conversationPublicId,
        );
      }
      await this.unitOfWork.executeInTransaction(async () => {
        const user = await this.users.findByPublicId(command.userPublicId);
        if (!user || user.isBanned)
          throw Errors.forbidden("Account unavailable");
        const conversation = await this.conversations.acquireForMutation(
          command.conversationPublicId,
        );
        const participantIds = getParticipantIds(conversation.participants);
        let notificationIds: string[] = [];

        if (command.action === "delete") {
          if (!participantIds.includes(user.id))
            throw Errors.forbidden(
              "You do not have access to this conversation",
            );
          if (conversation.isLocked)
            throw Errors.forbidden("Conversation locked by admin");
          await this.conversations.findOneAndUpdate(
            { _id: conversation._id },
            {
              $addToSet: { hiddenFor: new Types.ObjectId(user.id) },
              $set: {
                [`clearedAt.${user.id}`]:
                  conversation.lastMessageAt ?? new Date(),
                [`unreadCounts.${user.id}`]: 0,
              },
            },
          );
          notificationIds = await this.conversations.deleteNotifications(
            conversation.publicId,
            command.userPublicId,
          );
        } else {
          if (!user.isAdmin)
            throw Errors.forbidden("Admin privileges required");
          if (command.action === "purge") {
            notificationIds = await this.conversations.purge(conversation);
          } else {
            await this.conversations.findOneAndUpdate(
              { _id: conversation._id },
              {
                $set: { isLocked: command.action === "lock" },
              },
            );
          }
        }

        const recipients =
          command.action === "delete"
            ? [command.userPublicId]
            : await resolveParticipantPublicIds(this.users, participantIds);
        await this.eventBus.queueTransactional(
          new ConversationsChangedEvent(
            recipients,
            notificationIds,
            requestLogIds,
          ),
        );
      });
      const durationMs = performance.now() - started;
      this.metrics.recordConversationAction(
        command.action,
        "succeeded",
        durationMs,
      );
      logger.info("Conversation mutation committed", {
        event: "messaging.conversation.action.completed",
        action: command.action,
        durationMs,
      });
    } catch (error) {
      const outcome =
        error instanceof AmbiguousTransactionCommitError
          ? "ambiguous"
          : typeof error === "object" &&
              error !== null &&
              "statusCode" in error &&
              typeof error.statusCode === "number" &&
              error.statusCode < 500
            ? "rejected"
            : "failed";
      this.metrics.recordConversationAction(
        command.action,
        outcome,
        performance.now() - started,
      );
      logger.log(
        outcome === "rejected" ? "warn" : "error",
        "Conversation mutation did not confirm success",
        {
          event: "messaging.conversation.action.failed",
          action: command.action,
          outcome,
          errorType: error instanceof Error ? error.name : "unknown",
        },
      );
      throw error;
    }
  }
}
