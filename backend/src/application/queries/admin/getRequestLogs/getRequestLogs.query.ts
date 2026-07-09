import { IQuery } from "@/application/common/interfaces/query.interface";

export interface GetRequestLogsOptions {
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
	statusCode?: number;
	startDate?: Date;
	endDate?: Date;
	search?: string;
}

export class GetRequestLogsQuery implements IQuery {
	readonly type = "GetRequestLogsQuery";

	constructor(public readonly options: GetRequestLogsOptions = {}) {}
}
