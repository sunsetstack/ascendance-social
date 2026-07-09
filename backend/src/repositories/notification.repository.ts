import { Model } from "mongoose";
import { INotification } from "@/types";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId } from "@/types/branded";

@injectable()
export class NotificationRepository extends BaseRepository<INotification> {
	constructor(@inject(TOKENS.Models.Notification) model: Model<INotification>) {
		super(model);
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
		return await query.exec() as INotification;
	}

	/**
	 * Get notifications for a user with pagination support
	 * @param userId - user publicId
	 * @param limit - number of notifications to fetch (default: 50)
	 * @param skip - number of notifications to skip for pagination (default: 0)
	 */
	async getNotifications(userId: UserPublicId, limit: number = 50, skip: number = 0): Promise<INotification[]> {
		return await this.model
			.find({ userId })
			.sort({ timestamp: -1 })
			.skip(skip)
			.limit(limit)
			.lean<INotification[]>()
			.exec();
	}

	/**
	 * Get notifications older than a specific timestamp (cursor-based pagination)
	 * Used for infinite scroll - always returns older notifications than the cursor
	 * @param userId - user publicId
	 * @param beforeTimestamp - fetch notifications older than this timestamp
	 * @param limit - number of notifications to fetch (default: 20)
	 */
	async getNotificationsBeforeTimestamp(
		userId: UserPublicId,
		beforeTimestamp: Date,
		limit: number = 20,
	): Promise<INotification[]> {
		return await this.model
			.find({
				userId,
				timestamp: { $lt: beforeTimestamp }, // older than cursor
			})
			.sort({ timestamp: -1 }) // most recent first (within the older set)
			.limit(limit)
			.lean<INotification[]>()
			.exec();
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
		logger.info(`[NotificationRepository] markAsRead start id=${notificationId} userId=${userId}`);
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
			logger.error(`[NotificationRepository] markAsRead error id=${notificationId} userId=${userId}:`, e);
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
