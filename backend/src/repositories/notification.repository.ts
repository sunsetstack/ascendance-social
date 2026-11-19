import { Model, Types } from "mongoose";
import { INotification, NotificationRecord } from "@/types";
import { requireNotificationRecord } from "@/utils/notification-plain";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId } from "@/types/branded";
import { requireTransactionSession } from "@/database/UnitOfWork";

@injectable()
export class NotificationRepository extends BaseRepository<INotification> {
	constructor(@inject(TOKENS.Models.Notification) model: Model<INotification>) {
		super(model);
	}

	async findExistingIds(userId: UserPublicId, ids: string[]): Promise<Set<string>> {
		if (ids.length === 0) return new Set();
		const notifications = await this.model.find({ userId, _id: { $in: ids } })
			.select("_id").lean().exec();
		return new Set(notifications.map((notification) => String(notification._id)));
	}

	async guardContentTarget(targetType: "post" | "comment", targetId?: string): Promise<boolean> {
		const session = requireTransactionSession();
		if (!targetId || (targetType === "comment" && !/^[0-9a-f]{24}$/i.test(targetId))) {
			return false;
		}
		const collection = this.model.db.collection(targetType === "post" ? "posts" : "comments");
		const filter = targetType === "post"
			? { publicId: targetId }
			: { _id: new Types.ObjectId(targetId), isDeleted: { $ne: true } };
		// A write makes concurrent deletion conflict with the transaction that inserts the notification.
		const result = await collection.updateOne(filter, { $inc: { notificationFence: 1 } }, { session });
		return result.matchedCount === 1;
	}

	async create(notificationData: Partial<INotification>): Promise<INotification> {
		const session = this.getSession();
		const notification = new this.model(notificationData);
		await notification.save({ session });
		return notification;
	}

	async createOnce(
		notificationData: Partial<INotification>,
		idempotencyKey: string,
	): Promise<INotification> {
		const session = this.getSession();
		const query = this.model.findOneAndUpdate(
			{ idempotencyKey },
			{
				$setOnInsert: {
					...notificationData,
					idempotencyKey,
				},
			},
			{
				new: true,
				upsert: true,
				setDefaultsOnInsert: true,
			},
		);
		if (session) query.session(session);
		const notification = await query.exec();
		if (!notification) throw new Error("Notification upsert returned no record");
		return notification;
	}

	/**
	 * Get notifications for a user with pagination support
	 * @param userId - user publicId
	 * @param limit - number of notifications to fetch (default: 50)
	 * @param skip - number of notifications to skip for pagination (default: 0)
	 */
	async getNotifications(userId: UserPublicId, limit: number = 50, skip: number = 0): Promise<NotificationRecord[]> {
		const notifications = await this.model
			.find({ userId })
			.sort({ timestamp: -1, _id: -1 })
			.skip(skip)
			.limit(limit)
			.lean()
			.exec();
		return notifications.map(requireNotificationRecord);
	}

	/**
	 * Get notifications after a descending timestamp and ID cursor.
	 * Timestamp-only cursors retain the legacy strictly older behavior.
	 * @param userId - user publicId
	 * @param beforeTimestamp - fetch notifications older than this timestamp
	 * @param limit - number of notifications to fetch (default: 20)
	 * @param beforeId - ID of the last notification on the previous page
	 */
	async getNotificationsBeforeTimestamp(
		userId: UserPublicId,
		beforeTimestamp: Date,
		limit: number = 20,
		beforeId?: string,
	): Promise<NotificationRecord[]> {
		const notifications = await this.model
			.find({
				userId,
				...(beforeId
					? { $or: [
						{ timestamp: { $lt: beforeTimestamp } },
						{ timestamp: beforeTimestamp, _id: { $lt: new Types.ObjectId(beforeId) } },
					] }
					: { timestamp: { $lt: beforeTimestamp } }),
			})
			.sort({ timestamp: -1, _id: -1 })
			.limit(limit)
			.lean()
			.exec();
		return notifications.map(requireNotificationRecord);
	}

	/**
	 * Get count of unread notifications for a user
	 * Uses the compound index { userId: 1, isRead: 1 } for optimal performance
	 */
	async getUnreadCount(userId: UserPublicId): Promise<number> {
		return this.model.countDocuments({ userId, isRead: false }).exec();
	}

	async markAsRead(notificationId: MongoId, userId: UserPublicId) {
		if (!notificationId || !/^[0-9a-fA-F]{24}$/.test(notificationId)) {
			logger.warn(`[NotificationRepository] Invalid notificationId format: ${notificationId}`);
			return null;
		}
		logger.info("Marking notification as read", {
			event: "notification.mark_as_read.started",
		});
		try {
			const updated = await this.model
				.findOneAndUpdate({ _id: notificationId, userId }, { $set: { isRead: true } }, { new: true })
				.lean<INotification>()
				.exec();
			if (!updated) {
				logger.warn(
					`[NotificationRepository] markAsRead miss (not found or ownership mismatch) id=${notificationId} userId=${userId}`,
				);
			} else {
				logger.info(
					`[NotificationRepository] markAsRead success id=${notificationId} userId=${userId} isRead=${updated.isRead}`,
				);
			}
			return updated;
		} catch (e) {
			throw e;
		}
	}

	/**
	 * Mark all notifications as read for a user
	 * Useful for "mark all as read" functionality
	 */
	async markAllAsRead(userId: UserPublicId): Promise<number> {
		const result = await this.model.updateMany({ userId, isRead: false }, { $set: { isRead: true } }).exec();
		return result.modifiedCount;
	}

	/**
	 * Delete old read notifications for a user (cleanup)
	 * @param userId - user publicId
	 * @param olderThanDays - delete notifications older than this many days (default: 30)
	 */
	async deleteOldReadNotifications(userId: UserPublicId, olderThanDays: number = 30): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

		const result = await this.model
			.deleteMany({
				userId,
				isRead: true,
				timestamp: { $lt: cutoffDate },
			})
			.exec();

		return result.deletedCount;
	}

	async deleteManyByUserId(userId: UserPublicId): Promise<number> {
		const session = this.getSession();
		const result = await this.model
			.deleteMany({ userId })
			.session(session || null)
			.exec();
		return result.deletedCount || 0;
	}

	async deleteManyByActorId(actorId: UserPublicId): Promise<number> {
		const session = this.getSession();
		const result = await this.model
			.deleteMany({ actorId })
			.session(session || null)
			.exec();
		return result.deletedCount || 0;
	}
}
