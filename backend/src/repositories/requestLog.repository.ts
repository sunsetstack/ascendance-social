import { injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IRequestLog, PaginationOptions, PaginationResult, CursorPaginationResult } from "@/types";
import { RequestLogModel } from "@/models/requestLog.model";
import { Errors } from "@/utils/errors";
import { encodeCursor, decodeCursor } from "@/utils/cursorCodec";
import mongoose from "mongoose";

interface RequestLogCursor {
	timestamp: string;
	_id: string;
	[key: string]: unknown;
}

@injectable()
export class RequestLogRepository extends BaseRepository<IRequestLog> {
	constructor() {
		super(RequestLogModel);
	}

	/**
	 * Cursor-based pagination for request logs - efficient for large datasets.
	 */
	async findWithCursor(
		limit: number = 100,
		cursor?: string,
		filter: Record<string, unknown> = {},
	): Promise<CursorPaginationResult<IRequestLog>> {
		try {
			const decodedCursor = decodeCursor<RequestLogCursor>(cursor);
			const queryFilter = { ...filter };

			if (decodedCursor) {
				queryFilter.$or = [
					{ timestamp: { $lt: new Date(decodedCursor.timestamp) } },
					{
						timestamp: new Date(decodedCursor.timestamp),
						_id: { $lt: new mongoose.Types.ObjectId(decodedCursor._id) },
					},
				];
			}

			const logs = await this.model
				.find(queryFilter)
				.sort({ timestamp: -1, _id: -1 })
				.limit(limit + 1)
				.lean<IRequestLog[]>()
				.exec();

			const hasMore = logs.length > limit;
			const data = hasMore ? logs.slice(0, limit) : logs;

			let nextCursor: string | undefined;
			if (hasMore && data.length > 0) {
				const lastItem = data[data.length - 1];
				nextCursor = encodeCursor({
					timestamp: lastItem.timestamp instanceof Date ? lastItem.timestamp.toISOString() : new Date(String(lastItem.timestamp)).toISOString(),
					_id: String(lastItem._id),
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
	 * Stream logs for a date range using MongoDB cursor.
	 * Yields batches of logs for memory-efficient processing of large datasets.
	 */
	async *streamLogsByDateRange(
		startDate: Date,
		endDate: Date,
		batchSize: number = 100,
	): AsyncGenerator<IRequestLog[], void, unknown> {
		const cursor = this.model
			.find({ timestamp: { $gte: startDate, $lte: endDate } })
			.sort({ timestamp: -1 })
			.lean<IRequestLog>()
			.cursor({ batchSize });

		let batch: IRequestLog[] = [];
		
		for await (const doc of cursor) {
			batch.push(doc);
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
		}
		
		// Yield any remaining documents
		if (batch.length > 0) {
			yield batch;
		}
	}

	async findWithPagination(options: PaginationOptions): Promise<PaginationResult<IRequestLog>> {
		try {
			const { page = 1, limit = 50, sortBy = "timestamp", sortOrder = "desc", filter = {} } = options;

			const skip = (page - 1) * limit;
			const sort = { [sortBy]: sortOrder };

			const [data, total] = await Promise.all([
				this.model.find(filter).sort(sort).skip(skip).limit(limit).lean<IRequestLog[]>().exec(),
				this.model.countDocuments(filter),
			]);

			return {
				data,
				total,
				page,
				limit,
				totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
			};
		} catch (error) {
			if (error instanceof Error) {
				throw Errors.database(error.message);
			}
			throw Errors.database(String(error));
		}
	}

	async findRecentLogs(limit = 100): Promise<IRequestLog[]> {
		return await this.model.find().sort({ timestamp: -1 }).limit(limit).lean<IRequestLog[]>().exec();
	}

	async findLogsByDateRange(startDate: Date, endDate: Date): Promise<IRequestLog[]> {
		return await this.model
			.find({ timestamp: { $gte: startDate, $lte: endDate } })
			.sort({ timestamp: -1 })
			.lean<IRequestLog[]>()
			.exec();
	}

	async findLogsByUserId(userId: string, limit = 50): Promise<IRequestLog[]> {
		return await this.model
			.find({ "metadata.userId": userId })
			.sort({ timestamp: -1 })
			.limit(limit)
			.lean<IRequestLog[]>()
			.exec();
	}

	async findLogsByStatusCode(statusCode: number, limit = 100): Promise<IRequestLog[]> {
		return await this.model
			.find({ "metadata.statusCode": statusCode })
			.sort({ timestamp: -1 })
			.limit(limit)
			.lean<IRequestLog[]>()
			.exec();
	}

	async getAverageResponseTime(startDate?: Date, endDate?: Date): Promise<number> {
		const match = startDate && endDate ? { timestamp: { $gte: startDate, $lte: endDate } } : {};

		const result = await this.model.aggregate([
			{ $match: match },
			{ $group: { _id: null, avg: { $avg: "$metadata.responseTimeMs" } } },
		]);

		return result.length > 0 ? result[0].avg : 0;
	}
}
