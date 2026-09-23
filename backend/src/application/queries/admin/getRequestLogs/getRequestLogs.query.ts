import { IQuery } from "@/application/common/interfaces/query.interface";

export interface GetRequestLogsOptions {
	page?: number;
	limit?: number;
	userId?: string;
	ip?: string;
	correlationId?: string;
	clientRequestId?: string;
	clientBootId?: string;
	previousClientRequestId?: string;
	causedByClientRequestId?: string;
	authState?: string;
	authSource?: string;
	method?: string;
	statusCode?: number;
	startDate?: Date;
	endDate?: Date;
	snapshotAt?: Date;
	search?: string;
}

export class GetRequestLogsQuery implements IQuery {
	readonly type = "GetRequestLogsQuery";

	constructor(public readonly options: GetRequestLogsOptions = {}) {}
}
