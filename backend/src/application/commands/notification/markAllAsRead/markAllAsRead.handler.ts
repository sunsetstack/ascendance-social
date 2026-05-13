import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { MarkAllAsReadCommand } from "./markAllAsRead.command";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { Errors, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MarkAllAsReadCommandHandler
  implements ICommandHandler<MarkAllAsReadCommand, number>
{
  constructor(
    @inject(TOKENS.Models.WebSocketServer)
    private readonly webSocketServer: WebSocketServer,
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async execute(command: MarkAllAsReadCommand): Promise<number> {
    try {
      const { userPublicId } = command;

      const modifiedCount =
        await this.notificationRepository.markAllAsRead(userPublicId);

      if (modifiedCount > 0) {
        const notificationIds =
          await this.redisService.getUserNotificationIds(userPublicId);
        if (notificationIds.length > 0) {
          await this.redisService.markNotificationsRead(notificationIds);
        }

        this.webSocketServer.getIO().to(userPublicId).emit("all_notifications_read");
      }

      return modifiedCount;
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "markAllAsRead", userPublicId: command.userPublicId },
      });
    }
  }
}
