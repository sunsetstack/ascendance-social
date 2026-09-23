import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetRequestLogsQuery } from "./getRequestLogs.query";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import {
  ClientFingerprint,
  IRequestLog,
  PaginationResult,
  VisitorObservation,
} from "@/types";
import { escapeRegex } from "@/utils/sanitizers";
import { TOKENS } from "@/types/tokens";
import { sanitizeObservedUrl } from "@/utils/client-evidence";
import {
  buildUnauthenticatedEvidenceFilter,
  isUnauthenticatedEvidence,
} from "../admin-log-evidence";

export interface RequestLogDTO {
  timestamp: Date;
  method: string;
  route: string;
  ip: string;
  statusCode: number;
  responseTimeMs: number;
  correlationId?: string;
  userId?: string;
  evidenceVisibility: "observed_unverified" | "restricted_authenticated";
  authState?: string;
  authSource?: string;
  authAction?: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
  clientFingerprint?: ClientFingerprint;
  clientFingerprintSchemaVersion?: number;
  visitorObservation?: VisitorObservation;
  aborted?: boolean;
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
      ip,
      correlationId,
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
      snapshotAt,
      search,
    } = query.options;

    const filter: any = {};

    if (userId) {
      filter["metadata.userId"] = userId;
    }

    if (ip) {
      filter["metadata.ip"] = ip;
      filter.$and = buildUnauthenticatedEvidenceFilter().$and;
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

    if (method) {
      filter["metadata.method"] = method;
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
      // If filter.$or already exists (unlikely given previous logic, but safe to check), merge or push
      // For now, assume exclusive usage of simple filters + search
      filter.$or = [
        { "metadata.method": regex },
        { "metadata.route": regex },
        { "metadata.correlationId": regex },
        { "metadata.userId": regex },
        { "metadata.clientRequestId": regex },
        { "metadata.clientBootId": regex },
        { "metadata.previousClientRequestId": regex },
        { "metadata.causedByClientRequestId": regex },
        { "metadata.authState": regex },
        { "metadata.authSource": regex },
        {
          $and: [
            ...(buildUnauthenticatedEvidenceFilter().$and as object[]),
            { "metadata.visitorObservation.path": regex },
          ],
        },
      ];
    }

    const result = await this.requestLogRepository.findWithPagination({
      page,
      limit,
      filter,
      sortBy: "timestamp",
      sortOrder: "desc",
    });

    const transformedData = result.data.map((log: IRequestLog) => {
      const authState = log.metadata.authState || "unknown";
      const exposeEvidence = isUnauthenticatedEvidence({
        userId: log.metadata.userId,
        authState: log.metadata.authState,
      });
      const visitorObservation =
        exposeEvidence &&
        log.metadata.visitorObservation?.schemaVersion === 1 &&
        log.metadata.visitorObservation.path
          ? log.metadata.visitorObservation
          : undefined;
      const clientFingerprint =
        exposeEvidence && log.metadata.clientFingerprint?.schemaVersion === 1
          ? log.metadata.clientFingerprint
          : undefined;

      return {
        timestamp: log.timestamp,
        method: log.metadata.method,
        route: log.metadata.route,
        ip: exposeEvidence ? log.metadata.ip : "[restricted]",
        statusCode: log.metadata.statusCode,
        responseTimeMs: log.metadata.responseTimeMs,
        correlationId: log.metadata.correlationId,
        userId: log.metadata.userId,
        evidenceVisibility: exposeEvidence
          ? ("observed_unverified" as const)
          : ("restricted_authenticated" as const),
        authState,
        authSource: log.metadata.authSource,
        authAction: log.metadata.authAction,
        userAgent: exposeEvidence ? log.metadata.userAgent : undefined,
        origin: exposeEvidence
          ? sanitizeObservedUrl(log.metadata.origin, "origin")
          : undefined,
        referer: exposeEvidence
          ? sanitizeObservedUrl(log.metadata.referer, "referer")
          : undefined,
        clientFingerprint,
        clientFingerprintSchemaVersion: exposeEvidence
          ? clientFingerprint
            ? (log.metadata.clientFingerprintSchemaVersion ?? 1)
            : 0
          : undefined,
        visitorObservation,
        aborted: log.metadata.aborted,
        clientRequestId: log.metadata.clientRequestId,
        clientBootId: log.metadata.clientBootId,
        clientRequestAttempt: log.metadata.clientRequestAttempt,
        axiosRetry: log.metadata.axiosRetry,
        previousClientRequestId: log.metadata.previousClientRequestId,
        causedByClientRequestId: log.metadata.causedByClientRequestId,
        refreshRotated: log.metadata.refreshRotated,
      };
    });

    return {
      data: transformedData,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
