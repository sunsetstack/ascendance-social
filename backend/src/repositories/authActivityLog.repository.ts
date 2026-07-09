import { injectable } from "tsyringe";
import mongoose from "mongoose";
import { BaseRepository } from "./base.repository";
import { IAuthActivityLog, PaginationOptions, PaginationResult, CursorPaginationResult } from "@/types";
import { AuthActivityLogModel } from "@/models/authActivityLog.model";
import { Errors } from "@/utils/errors";
import { encodeCursor, decodeCursor } from "@/utils/cursorCodec";

interface AuthActivityLogCursor {
  timestamp: string;
  _id: string;
  [key: string]: unknown;
}

@injectable()
export class AuthActivityLogRepository extends BaseRepository<IAuthActivityLog> {
  constructor() {
    super(AuthActivityLogModel);
  }

  async findWithCursor(
    limit: number = 100,
    cursor?: string,
    filter: Record<string, unknown> = {},
  ): Promise<CursorPaginationResult<IAuthActivityLog>> {
    try {
      const decodedCursor = decodeCursor<AuthActivityLogCursor>(cursor);
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
        .lean<IAuthActivityLog[]>()
        .exec();

      const hasMore = logs.length > limit;
      const data = hasMore ? logs.slice(0, limit) : logs;

      let nextCursor: string | undefined;
      if (hasMore && data.length > 0) {
        const lastItem = data[data.length - 1];
        nextCursor = encodeCursor({
          timestamp:
            lastItem.timestamp instanceof Date
              ? lastItem.timestamp.toISOString()
              : new Date(String(lastItem.timestamp)).toISOString(),
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

  async findWithPagination(options: PaginationOptions): Promise<PaginationResult<IAuthActivityLog>> {
    try {
      const { page = 1, limit = 50, sortBy = "timestamp", sortOrder = "desc", filter = {} } = options;
      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder };

      const [data, total] = await Promise.all([
        this.model.find(filter).sort(sort).skip(skip).limit(limit).lean<IAuthActivityLog[]>().exec(),
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

  async findRecentLogs(limit = 100): Promise<IAuthActivityLog[]> {
    return this.model.find().sort({ timestamp: -1 }).limit(limit).lean<IAuthActivityLog[]>().exec();
  }
}
