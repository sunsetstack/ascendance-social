import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAuthActivityLogsQuery } from "./getAuthActivityLogs.query";
import { AuthActivityLogRepository } from "@/repositories/authActivityLog.repository";
import { PaginationResult } from "@/types";
import { escapeRegex } from "@/utils/sanitizers";
import { TOKENS } from "@/types/tokens";

export interface AuthActivityLogDTO {
  timestamp: Date;
  action: string;
  ip: string;
  origin?: string;
  referer?: string;
  statusCode?: number;
  responseTimeMs?: number;
  userId?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  userAgent?: string;
  correlationId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  authState?: string;
  authSource?: string;
  refreshRotated?: boolean;
  route?: string;
}

@injectable()
export class GetAuthActivityLogsQueryHandler implements IQueryHandler<
  GetAuthActivityLogsQuery,
  PaginationResult<AuthActivityLogDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.AuthActivityLog)
    private readonly authActivityLogRepository: AuthActivityLogRepository,
  ) {}

  async execute(
    query: GetAuthActivityLogsQuery,
  ): Promise<PaginationResult<AuthActivityLogDTO>> {
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
      action,
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

    if (action) {
      filter["metadata.action"] = action;
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
      filter.$or = [
        { "metadata.ip": regex },
        { "metadata.authEmail": regex },
        { "metadata.authUsername": regex },
        { "metadata.authHandle": regex },
        { "metadata.action": regex },
        { "metadata.correlationId": regex },
        { "metadata.clientRequestId": regex },
        { "metadata.clientBootId": regex },
        { "metadata.previousClientRequestId": regex },
        { "metadata.causedByClientRequestId": regex },
        { "metadata.sessionId": regex },
        { "metadata.tokenFamilyId": regex },
        { "metadata.authState": regex },
        { "metadata.authSource": regex },
        { "metadata.route": regex },
      ];
    }

    const result = await this.authActivityLogRepository.findWithPagination({
      page,
      limit,
      filter,
      sortBy: "timestamp",
      sortOrder: "desc",
    });

    return {
      data: result.data.map((log) => ({
        timestamp: log.timestamp,
        action: log.metadata.action,
        ip: log.metadata.ip,
        origin: log.metadata.origin,
        referer: log.metadata.referer,
        statusCode: log.metadata.statusCode,
        responseTimeMs: log.metadata.responseTimeMs,
        userId: log.metadata.userId,
        authEmail: log.metadata.authEmail,
        authUsername: log.metadata.authUsername,
        authHandle: log.metadata.authHandle,
        userAgent: log.metadata.userAgent,
        correlationId: log.metadata.correlationId,
        clientRequestId: log.metadata.clientRequestId,
        clientBootId: log.metadata.clientBootId,
        clientRequestAttempt: log.metadata.clientRequestAttempt,
        axiosRetry: log.metadata.axiosRetry,
        previousClientRequestId: log.metadata.previousClientRequestId,
        causedByClientRequestId: log.metadata.causedByClientRequestId,
        sessionId: log.metadata.sessionId,
        tokenFamilyId: log.metadata.tokenFamilyId,
        authState: log.metadata.authState,
        authSource: log.metadata.authSource,
        refreshRotated: log.metadata.refreshRotated,
        route: log.metadata.route,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
