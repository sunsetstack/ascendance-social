import { IQuery } from "@/application/common/interfaces/query.interface";

export interface GetAuthActivityLogsOptions {
  page?: number;
  limit?: number;
  userId?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  authState?: string;
  authSource?: string;
  action?: string;
  statusCode?: number;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

export class GetAuthActivityLogsQuery implements IQuery {
  readonly type = "GetAuthActivityLogsQuery";

  constructor(public readonly options: GetAuthActivityLogsOptions = {}) {}
}
