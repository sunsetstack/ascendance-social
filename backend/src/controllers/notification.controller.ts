import { Response } from "express";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetNotificationsQuery } from "@/application/queries/notification/getNotifications/getNotifications.query";
import { GetUnreadCountQuery } from "@/application/queries/notification/getUnreadCount/getUnreadCount.query";
import { MarkAsReadCommand } from "@/application/commands/notification/markAsRead/markAsRead.command";
import { MarkAllAsReadCommand } from "@/application/commands/notification/markAllAsRead/markAllAsRead.command";
import { Errors } from "@/utils/errors";
import { streamCursorResponse } from "@/utils/streamResponse";
import { inject, injectable } from "tsyringe";
import { logger } from "@/utils/winston";
import { TypedRequest, NotificationPlain } from "@/types";
import { TOKENS } from "@/types/tokens";
import type {
  NotificationIdParams,
  NotificationQuery,
} from "@/utils/schemas/notification.schemas";

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class NotificationController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  getNotifications = async (
    req: TypedRequest<EmptyParams, EmptyBody, NotificationQuery>,
    res: Response,
  ) => {
    const { decodedUser } = req;
    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.validation("User publicId is required");
    }
    const userPublicId = decodedUser.publicId;

    // cursor-based pagination support
    const { before, limit } = req.query;
    const beforeTimestamp = before?.getTime();

    const notifications = await this.queryBus.execute<NotificationPlain[]>(
      new GetNotificationsQuery(userPublicId, limit, beforeTimestamp)
    );

    logger.info(
      `[NOTIFICATIONS] Fetched ${notifications.length} notifications for user: ${userPublicId}` +
        (beforeTimestamp !== undefined
          ? ` (before: ${new Date(beforeTimestamp).toISOString()})`
          : " (initial load)"),
    );

    // Determine if there are more notifications (heuristic: if we got exactly limit, there may be more)
    const hasMore = notifications.length === limit;
    // Generate next cursor from the oldest notification's timestamp.
    // timestamp may be a Date (MongoDB document) or a string (Redis-cached plain object),
    // so coerce to Date before calling toISOString().
    const lastTimestamp =
      notifications.length > 0
        ? notifications[notifications.length - 1]?.timestamp
        : undefined;
    const nextCursor =
      hasMore && lastTimestamp !== undefined
        ? new Date(lastTimestamp).toISOString()
        : undefined;

    if (notifications.length >= STREAM_THRESHOLD) {
      streamCursorResponse(res, notifications, {
        hasMore,
        nextCursor,
      });
    } else {
      res.status(200).json({
        data: notifications,
        hasMore,
        nextCursor,
      });
    }
  };

  markAsRead = async (
    req: TypedRequest<NotificationIdParams>,
    res: Response,
  ) => {
    const { notificationId } = req.params;
    const { decodedUser } = req;
    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.validation("User publicId is required");
    }
    const userPublicId = decodedUser.publicId;
    const notification = await this.commandBus.dispatch(
      new MarkAsReadCommand(notificationId, userPublicId)
    );
    res.status(200).json(notification);
  };

  getUnreadCount = async (req: TypedRequest, res: Response) => {
    const { decodedUser } = req;
    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.validation("User publicId is required");
    }
    const userPublicId = decodedUser.publicId;
    const count = await this.queryBus.execute<number>(
      new GetUnreadCountQuery(userPublicId)
    );
    res.status(200).json({ count });
  };

  markAllAsRead = async (req: TypedRequest, res: Response) => {
    const { decodedUser } = req;
    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.validation("User publicId is required");
    }
    const userPublicId = decodedUser.publicId;
    const modifiedCount = await this.commandBus.dispatch<number>(
      new MarkAllAsReadCommand(userPublicId)
    );
    res.status(200).json({ modifiedCount });
  };
}
