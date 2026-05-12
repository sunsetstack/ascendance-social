import mongoose, { Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IMessage, IMessageWithPopulatedSender, PaginationResult, CursorPaginationResult } from "@/types";
import { Errors } from "@/utils/errors";
import { encodeCursor, decodeCursor } from "@/utils/cursorCodec";
import { TOKENS } from "@/types/tokens";

interface MessageCursor {
	createdAt: string;
	_id: string;
	[key: string]: unknown;
}

@injectable()
export class MessageRepository extends BaseRepository<IMessage> {
	constructor(@inject(TOKENS.Models.Message) model: Model<IMessage>) {
		super(model);
	}

	async findByPublicId(publicId: string): Promise<IMessage | null> {
		const session = this.getSession();
		const query = this.model.findOne({ publicId }).populate("sender", "publicId handle username avatar");
		if (session) query.session(session);
		return query.exec();
	}

	/**
	 * Cursor-based pagination for messages - more efficient for large conversations.
	 * Uses createdAt + _id as cursor to avoid skip() overhead.
	 */
	async findMessagesByConversationWithCursor(
		conversationId: string,
		limit: number = 50,
		cursor?: string,
	): Promise<CursorPaginationResult<IMessageWithPopulatedSender>> {
		try {
			const objectId = new mongoose.Types.ObjectId(conversationId);
			const decodedCursor = decodeCursor<MessageCursor>(cursor);

			// Build filter with cursor condition for efficient pagination
			const filter: Record<string, unknown> = { conversation: objectId };
			
			if (decodedCursor) {
				// Get messages older than cursor (for descending order)
				filter.$or = [
					{ createdAt: { $lt: new Date(decodedCursor.createdAt) } },
					{
						createdAt: new Date(decodedCursor.createdAt),
						_id: { $lt: new mongoose.Types.ObjectId(decodedCursor._id) },
					},
				];
			}

			// Fetch one extra to determine if there are more results
			const messages = await this.model
				.find(filter)
				.sort({ createdAt: -1, _id: -1 })
				.limit(limit + 1)
				.populate("sender", "publicId handle username avatar")
				.lean<IMessageWithPopulatedSender[]>()
				.exec();

			const hasMore = messages.length > limit;
			const data = hasMore ? messages.slice(0, limit) : messages;

			// Build next cursor from last item
			let nextCursor: string | undefined;
			if (hasMore && data.length > 0) {
				const lastItem = data[data.length - 1];
				nextCursor = encodeCursor({
					createdAt: lastItem.createdAt.toISOString(),
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

	/**
	 * @deprecated Use findMessagesByConversationWithCursor for better performance on large datasets
	 */
	async findMessagesByConversation(
		conversationId: string,
		page: number,
		limit: number
	): Promise<PaginationResult<IMessageWithPopulatedSender>> {
		try {
			const skip = (page - 1) * limit;
			const objectId = new mongoose.Types.ObjectId(conversationId);

			const [messages, total] = await Promise.all([
				this.model
					.find({ conversation: objectId })
					.sort({ createdAt: -1 })
					.skip(skip)
					.limit(limit)
					.populate("sender", "publicId handle username avatar")
					.lean<IMessageWithPopulatedSender[]>()
					.exec(),
				this.model.countDocuments({ conversation: objectId }),
			]);

			return {
				data: messages,
				total,
				page,
				limit,
				totalPages: total > 0 ? Math.ceil(total / limit) : 0,
			};
		} catch (error) {
			throw Errors.database(error instanceof Error ? error.message : String(error));
		}
	}

	// Trying different session handling here
	async markConversationMessagesAsRead(
		conversationId: string,
		readerId: string
	): Promise<void> {
		const session = this.getSession();
		const update = this.model.updateMany(
			{
				conversation: new mongoose.Types.ObjectId(conversationId),
				sender: { $ne: new mongoose.Types.ObjectId(readerId) },
				readBy: { $ne: new mongoose.Types.ObjectId(readerId) },
			},
			{
				$addToSet: { readBy: new mongoose.Types.ObjectId(readerId) },
				$set: { status: "read" },
			}
		);

		if (session) update.session(session);
		await update.exec();
	}

	async markConversationMessagesAsDelivered(
		conversationId: string,
		recipientId: string,
	): Promise<boolean> {
		const session = this.getSession();
		const update = this.model.updateMany(
			{
				conversation: new mongoose.Types.ObjectId(conversationId),
				sender: { $ne: new mongoose.Types.ObjectId(recipientId) },
				status: "sent",
			},
			{
				$set: { status: "delivered" },
			},
		);

		if (session) update.session(session);
		const result = await update.exec();
		return (result.modifiedCount ?? 0) > 0;
	}

	async findMessageById(messageId: string): Promise<IMessage | null> {
		const session = this.getSession();
		const query = this.model
			.findById(new mongoose.Types.ObjectId(messageId))
			.populate("sender", "publicId handle username avatar");
		if (session) query.session(session);
		return query.exec();
	}

	async deleteManyBySender(senderId: string): Promise<number> {
		const session = this.getSession();
		const result = await this.model
			.deleteMany({ sender: new mongoose.Types.ObjectId(senderId) })
			.session(session || null)
			.exec();
		return result.deletedCount || 0;
	}

	async removeUserFromReadBy(userId: string): Promise<number> {
		const session = this.getSession();
		const result = await this.model
			.updateMany(
				{ readBy: new mongoose.Types.ObjectId(userId) },
				{ $pull: { readBy: new mongoose.Types.ObjectId(userId) } }
			)
			.session(session || null)
			.exec();
		return result.modifiedCount || 0;
	}

	async updateMessage(publicId: string, updates: Partial<IMessage>): Promise<IMessage | null> {
		const session = this.getSession();
		const query = this.model
			.findOneAndUpdate({ publicId }, { $set: updates }, { new: true })
			.populate("sender", "publicId handle username avatar");
		
		if (session) query.session(session);
		return query.exec();
	}
}
