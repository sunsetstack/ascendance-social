import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUnreadCountQuery } from "./getUnreadCount.query";
import { NotificationRepository } from "@/repositories/notification.repository";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetUnreadCountQueryHandler
  implements IQueryHandler<GetUnreadCountQuery, number>
{
  constructor(
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(query: GetUnreadCountQuery): Promise<number> {
    return this.notificationRepository.getUnreadCount(query.userPublicId);
  }
}
