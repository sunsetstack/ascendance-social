import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAuthActivityLogsQuery } from "./getAuthActivityLogs.query";
import { AuthActivityLogRepository } from "@/repositories/authActivityLog.repository";
import { ClientFingerprint, PaginationResult } from "@/types";
import { escapeRegex } from "@/utils/sanitizers";
import { TOKENS } from "@/types/tokens";
import { sanitizeObservedUrl } from "@/utils/client-evidence";

export interface AuthActivityLogDTO {
  timestamp: Date;
  action: string;
  ip: string;
  statusCode?: number;
  responseTimeMs?: number;
  userId?: string;
  evidenceVisibility: "observed_unverified" | "restricted_authenticated";
  correlationId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  authState?: string;
  authSource?: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
  clientFingerprint?: ClientFingerprint;
  clientFingerprintSchemaVersion?: number;
  aborted?: boolean;
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
      ip,
      correlationId,
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
      snapshotAt,
      search,
    } = query.options;

    const filter: any = {};

    if (userId) {
      filter["metadata.userId"] = userId;
    }

    if (ip) {
      filter["metadata.ip"] = ip;
    }

    if (correlationId) {
      filter["metadata.correlationId"] = correlationId;
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
      if (authState === "unknown") {
        filter.$and = [
          ...(filter.$and ?? []),
          {
            $or: [
              { "metadata.authState": { $exists: false } },
              { "metadata.authState": null },
              { "metadata.authState": "" },
              { "metadata.authState": "unknown" },
            ],
          },
        ];
      } else {
        filter["metadata.authState"] = authState;
      }
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

    if (startDate || endDate || snapshotAt) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = startDate;
      if (endDate) filter.timestamp.$lte = endDate;
      if (
        snapshotAt &&
        (!filter.timestamp.$lte ||
          snapshotAt.getTime() < filter.timestamp.$lte.getTime())
      ) {
        filter.timestamp.$lte = snapshotAt;
      }
    }

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [
        { "metadata.action": regex },
        { "metadata.correlationId": regex },
        { "metadata.clientRequestId": regex },
        { "metadata.clientBootId": regex },
        { "metadata.previousClientRequestId": regex },
        { "metadata.causedByClientRequestId": regex },
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
      data: result.data.map((log) => {
        const authState = log.metadata.authState || "unknown";
        const clientFingerprint = log.metadata.clientFingerprint;

        return {
          timestamp: log.timestamp,
          action: log.metadata.action,
          ip: log.metadata.ip,
          statusCode: log.metadata.statusCode,
          responseTimeMs: log.metadata.responseTimeMs,
          userId: log.metadata.userId,
          evidenceVisibility: "observed_unverified" as const,
          correlationId: log.metadata.correlationId,
          clientRequestId: log.metadata.clientRequestId,
          clientBootId: log.metadata.clientBootId,
          clientRequestAttempt: log.metadata.clientRequestAttempt,
          axiosRetry: log.metadata.axiosRetry,
          previousClientRequestId: log.metadata.previousClientRequestId,
          causedByClientRequestId: log.metadata.causedByClientRequestId,
          authState,
          authSource: log.metadata.authSource,
          userAgent: log.metadata.userAgent,
          origin: sanitizeObservedUrl(log.metadata.origin, "origin"),
          referer: sanitizeObservedUrl(log.metadata.referer, "referer"),
          clientFingerprint,
          clientFingerprintSchemaVersion: clientFingerprint
            ? (log.metadata.clientFingerprintSchemaVersion ?? 1)
            : 0,
          aborted: log.metadata.aborted,
          refreshRotated: log.metadata.refreshRotated,
          route: log.metadata.route,
        };
      }),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
