import mongoose, { Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IConversation, HydratedConversation, PaginationResult, CursorPaginationResult } from "@/types";
import { Errors } from "@/utils/errors";
import { encodeCursor, decodeCursor } from "@/utils/cursorCodec";
import { TOKENS } from "@/types/tokens";

interface ConversationCursor {
	lastMessageAt: string;
	_id: string;
	[key: string]: unknown;
}

/*
Notes on messaging system:

	Storing each message as its own MongoDB document is okay at moderate scale,
	but if volume grows significantly, certain guardrails must be put into place.
	
	- Shard or partition by conversationId so Mongo splits write load and keeps indexes bounded; 
			enable hashed sharding on conversationId + createdAt.
	- Bound indexes (compound { conversationId: 1, createdAt: -1 }) and avoid multi-field text indexes on the hot collection.
	- Cold-storage tiers: keep only the latest N (e.g., 5–20 k) messages per conversation in the primary messages collection,
			then roll off older ones to an archive collection or object storage via scheduled jobs.
	- Paginated reads using time or snowflake IDs rather than skip/limit to keep queries O(1).
	- Soft deletes/retention policies (per workspace, per conversation) stop infinite growth.
	- Attachment offloading: store blob metadata only; push files to S3/Cloudinary/other storage. 
			Just not in the message document itself.
	- Compression: enable MognoDB's WiredTiger block compression and keep payloads trimmed to reduce storage footprint.

	With sharding plus archival and retention policies, single-document messages remain manageable even at scale.
	For the current needs of the app, i'm keeping this approach. It's simple and flexible and I don't plan on
	having thousands of active users with millions of messages each. 
	This whole project is proof of concept.
*/
@injectable()
export class ConversationRepository extends BaseRepository<IConversation> {
	constructor(@inject(TOKENS.Models.Conversation) model: Model<IConversation>) {
		super(model);
	}

	async findByPublicId(
		publicId: string,
		options?: { populateParticipants?: boolean; includeLastMessage?: boolean }
	): Promise<IConversation | null> {
		const session = this.getSession();
		const query = this.model.findOne({ publicId });
		if (options?.populateParticipants) {
			query.populate("participants", "publicId handle username avatar");
		}
		if (options?.includeLastMessage) {
			query.populate({
				path: "lastMessage",
				populate: { path: "sender", select: "publicId handle username avatar" },
			});
		}
		if (session) query.session(session);
		return query.exec();
	}

	async findByParticipantHash(participantHash: string): Promise<IConversation | null> {
		const session = this.getSession();
		const query = this.model.findOne({ participantHash });
		if (session) query.session(session);
		return query.exec();
	}

	/**
	 * @deprecated Use findUserConversationsWithCursor for better performance on users with many conversations
	 */
	async findUserConversations(
		userId: string,
		page: number,
		limit: number
	): Promise<PaginationResult<HydratedConversation>> {
		try {
			const objectId = new mongoose.Types.ObjectId(userId);
			const skip = (page - 1) * limit;

			const pipeline: mongoose.PipelineStage[] = [
				{ $match: { participants: objectId } },
				{ $sort: { lastMessageAt: -1, updatedAt: -1 } },
				{
					$lookup: {
						from: "messages",
						localField: "lastMessage",
						foreignField: "_id",
						as: "lastMessage",
					},
				},
				{ $unwind: { path: "$lastMessage", preserveNullAndEmptyArrays: true } },
				{
					$lookup: {
						from: "users",
						let: { senderId: "$lastMessage.sender" },
						pipeline: [
							{ $match: { $expr: { $eq: ["$_id", "$$senderId"] } } },
							{ $project: { publicId: 1, handle: 1, username: 1, avatar: 1 } },
						],
						as: "lastMessageSender",
					},
				},
				{
					$addFields: {
						lastMessage: {
							$cond: {
								if: { $gt: [{ $size: "$lastMessageSender" }, 0] },
								then: {
									$mergeObjects: ["$lastMessage", { sender: { $arrayElemAt: ["$lastMessageSender", 0] } }],
								},
								else: "$lastMessage",
							},
						},
					},
				},
				{
					$lookup: {
						from: "users",
						localField: "participants",
						foreignField: "_id",
						as: "participants",
					},
				},
				{
					$project: {
						participantHash: 1,
						publicId: 1,
						participants: {
							$map: {
								input: "$participants",
								as: "participant",
								in: {
									_id: "$$participant._id",
									publicId: "$$participant.publicId",
									handle: "$$participant.handle",
									username: "$$participant.username",
									avatar: "$$participant.avatar",
								},
							},
						},
						lastMessage: 1,
						lastMessageAt: 1,
						unreadCounts: 1,
						isGroup: 1,
						title: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				},
				{ $skip: skip },
				{ $limit: limit },
			];

			const [data, total] = await Promise.all([
				this.model.aggregate(pipeline).exec(),
				this.model.countDocuments({ participants: objectId }),
			]);

			return {
				data,
				total,
				page,
				limit,
				totalPages: total > 0 ? Math.ceil(total / limit) : 0,
			};
		} catch (error) {
			throw Errors.database(error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Cursor-based pagination for conversations - more efficient for users with many conversations.
	 * Uses lastMessageAt + _id as cursor to avoid skip() overhead.
	 */
	async findUserConversationsWithCursor(
		userId: string,
		limit: number = 20,
		cursor?: string,
	): Promise<CursorPaginationResult<HydratedConversation>> {
		try {
			const objectId = new mongoose.Types.ObjectId(userId);
			const decodedCursor = decodeCursor<ConversationCursor>(cursor);

			// Build match stage with cursor condition
			const matchStage: Record<string, unknown> = { participants: objectId };

			if (decodedCursor) {
				matchStage.$or = [
					{ lastMessageAt: { $lt: new Date(decodedCursor.lastMessageAt) } },
					{
						lastMessageAt: new Date(decodedCursor.lastMessageAt),
						_id: { $lt: new mongoose.Types.ObjectId(decodedCursor._id) },
					},
				];
			}

			const pipeline: mongoose.PipelineStage[] = [
				{ $match: matchStage },
				{ $sort: { lastMessageAt: -1, _id: -1 } },
				{ $limit: limit + 1 }, // Fetch one extra to check hasMore
				{
					$lookup: {
						from: "messages",
						localField: "lastMessage",
						foreignField: "_id",
						as: "lastMessage",
					},
				},
				{ $unwind: { path: "$lastMessage", preserveNullAndEmptyArrays: true } },
				{
					$lookup: {
						from: "users",
						let: { senderId: "$lastMessage.sender" },
						pipeline: [
							{ $match: { $expr: { $eq: ["$_id", "$$senderId"] } } },
							{ $project: { publicId: 1, handle: 1, username: 1, avatar: 1 } },
						],
						as: "lastMessageSender",
					},
				},
				{
					$addFields: {
						lastMessage: {
							$cond: {
								if: { $gt: [{ $size: "$lastMessageSender" }, 0] },
								then: {
									$mergeObjects: ["$lastMessage", { sender: { $arrayElemAt: ["$lastMessageSender", 0] } }],
								},
								else: "$lastMessage",
							},
						},
					},
				},
				{
					$lookup: {
						from: "users",
						localField: "participants",
						foreignField: "_id",
						as: "participants",
					},
				},
				{
					$project: {
						participantHash: 1,
						publicId: 1,
						participants: {
							$map: {
								input: "$participants",
								as: "participant",
								in: {
									_id: "$$participant._id",
									publicId: "$$participant.publicId",
									handle: "$$participant.handle",
									username: "$$participant.username",
									avatar: "$$participant.avatar",
								},
							},
						},
						lastMessage: 1,
						lastMessageAt: 1,
						unreadCounts: 1,
						isGroup: 1,
						title: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				},
			];

			const results = await this.model.aggregate<HydratedConversation>(pipeline).exec();
			const hasMore = results.length > limit;
			const data = hasMore ? results.slice(0, limit) : results;

			// Build next cursor from last item
			let nextCursor: string | undefined;
			if (hasMore && data.length > 0) {
				const lastItem = data[data.length - 1];
				nextCursor = encodeCursor({
					lastMessageAt: lastItem.lastMessageAt?.toISOString() || lastItem.updatedAt?.toISOString(),
					_id: lastItem._id.toString(),
				});
			}

			return {
				data,
				hasMore,
				nextCursor,
			};
		} catch (error) {
			throw Errors.database(error instanceof Error ? error.message : String(error));
		}
	}

	async resetUnreadCount(conversationId: string, userId: string): Promise<void> {
		const session = this.getSession();
		const update = this.model.updateOne(
			{ _id: new mongoose.Types.ObjectId(conversationId) },
			{ $set: { [`unreadCounts.${userId}`]: 0 } }
		);
		if (session) update.session(session);
		await update.exec();
	}

	async incrementUnreadCounts(conversationId: string, recipientIds: string[]): Promise<void> {
		const session = this.getSession();
		if (recipientIds.length === 0) return;

		const update = this.model.updateOne(
			{ _id: new mongoose.Types.ObjectId(conversationId) },
			{
				$inc: recipientIds.reduce<Record<string, number>>((acc, recipientId) => {
					acc[`unreadCounts.${recipientId}`] = 1;
					return acc;
				}, {}),
			}
		);

		if (session) update.session(session);
		await update.exec();
	}

	async findByParticipant(userId: string): Promise<IConversation[]> {
		const session = this.getSession();
		const query = this.model.find({ participants: new mongoose.Types.ObjectId(userId) });
		if (session) query.session(session);
		return query.exec();
	}

	async removeParticipant(conversationId: string, userId: string): Promise<void> {
		const session = this.getSession();
		const update = this.model.updateOne(
			{ _id: new mongoose.Types.ObjectId(conversationId) },
			{ $pull: { participants: new mongoose.Types.ObjectId(userId) } }
		);
		if (session) update.session(session);
		await update.exec();
	}
}
