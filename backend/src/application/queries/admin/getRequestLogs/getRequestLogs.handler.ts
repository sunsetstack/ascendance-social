import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetRequestLogsQuery } from "./getRequestLogs.query";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { PaginationResult, IRequestLog } from "@/types";
import { escapeRegex } from "@/utils/sanitizers";
import { TOKENS } from "@/types/tokens";

export interface RequestLogDTO {
  timestamp: Date;
  method: string;
  route: string;
  ip: string;
  statusCode: number;
  responseTimeMs: number;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  authAction?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
}

@injectable()
export class GetRequestLogsQueryHandler implements IQueryHandler<
  GetRequestLogsQuery,
  PaginationResult<RequestLogDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.RequestLog)
    private readonly requestLogRepository: RequestLogRepository,
  ) {}

  async execute(
    query: GetRequestLogsQuery,
  ): Promise<PaginationResult<RequestLogDTO>> {
    const {
      page = 1,
      limit = 50,
      userId,
      statusCode,
      startDate,
      endDate,
      search,
    } = query.options;

    const filter: any = {};

    if (userId) {
      filter["metadata.userId"] = userId;
    }

    if (statusCode) {
      filter["metadata.statusCode"] = statusCode;
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = startDate;
      if (endDate) filter.timestamp.$lte = endDate;
    }

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      // If filter.$or already exists (unlikely given previous logic, but safe to check), merge or push
      // For now, assume exclusive usage of simple filters + search
      filter.$or = [
        { "metadata.ip": regex },
        { "metadata.method": regex },
        { "metadata.route": regex },
        { "metadata.correlationId": regex },
        { "metadata.userId": regex },
      ];
    }

    const result = await this.requestLogRepository.findWithPagination({
      page,
      limit,
      filter,
      sortBy: "timestamp",
      sortOrder: "desc",
    });

    const transformedData = result.data.map((log: IRequestLog) => ({
      timestamp: log.timestamp,
      method: log.metadata.method,
      route: log.metadata.route,
      ip: log.metadata.ip,
      statusCode: log.metadata.statusCode,
      responseTimeMs: log.metadata.responseTimeMs,
      correlationId: log.metadata.correlationId,
      userId: log.metadata.userId,
      userAgent: log.metadata.userAgent,
      authAction: log.metadata.authAction,
      authEmail: log.metadata.authEmail,
      authUsername: log.metadata.authUsername,
      authHandle: log.metadata.authHandle,
    }));

    return {
      data: transformedData,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
