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
  origin?: string;
  referer?: string;
  statusCode: number;
  responseTimeMs: number;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  authState?: string;
  authSource?: string;
  authAction?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  refreshRotated?: boolean;
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
      sessionId,
      tokenFamilyId,
      clientRequestId,
      clientBootId,
      previousClientRequestId,
      causedByClientRequestId,
      authState,
      authSource,
      method,
      statusCode,
      startDate,
      endDate,
      search,
    } = query.options;

    const filter: any = {};

    if (userId) {
      filter["metadata.userId"] = userId;
    }

    if (sessionId) {
      filter["metadata.sessionId"] = sessionId;
    }

    if (tokenFamilyId) {
      filter["metadata.tokenFamilyId"] = tokenFamilyId;
    }

    if (clientRequestId) {
      filter["metadata.clientRequestId"] = clientRequestId;
    }

    if (clientBootId) {
      filter["metadata.clientBootId"] = clientBootId;
    }

    if (previousClientRequestId) {
      filter["metadata.previousClientRequestId"] = previousClientRequestId;
    }

    if (causedByClientRequestId) {
      filter["metadata.causedByClientRequestId"] = causedByClientRequestId;
    }

    if (authState) {
      filter["metadata.authState"] = authState;
    }

    if (authSource) {
      filter["metadata.authSource"] = authSource;
    }

    if (method) {
      filter["metadata.method"] = method;
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
        { "metadata.authEmail": regex },
        { "metadata.authUsername": regex },
        { "metadata.authHandle": regex },
        { "metadata.sessionId": regex },
        { "metadata.tokenFamilyId": regex },
        { "metadata.clientRequestId": regex },
        { "metadata.clientBootId": regex },
        { "metadata.previousClientRequestId": regex },
        { "metadata.causedByClientRequestId": regex },
        { "metadata.authState": regex },
        { "metadata.authSource": regex },
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
      origin: log.metadata.origin,
      referer: log.metadata.referer,
      statusCode: log.metadata.statusCode,
      responseTimeMs: log.metadata.responseTimeMs,
      correlationId: log.metadata.correlationId,
      userId: log.metadata.userId,
      userAgent: log.metadata.userAgent,
      authState: log.metadata.authState,
      authSource: log.metadata.authSource,
      authAction: log.metadata.authAction,
      authEmail: log.metadata.authEmail,
      authUsername: log.metadata.authUsername,
      authHandle: log.metadata.authHandle,
      sessionId: log.metadata.sessionId,
      tokenFamilyId: log.metadata.tokenFamilyId,
      clientRequestId: log.metadata.clientRequestId,
      clientBootId: log.metadata.clientBootId,
      clientRequestAttempt: log.metadata.clientRequestAttempt,
      axiosRetry: log.metadata.axiosRetry,
      previousClientRequestId: log.metadata.previousClientRequestId,
      causedByClientRequestId: log.metadata.causedByClientRequestId,
      refreshRotated: log.metadata.refreshRotated,
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
