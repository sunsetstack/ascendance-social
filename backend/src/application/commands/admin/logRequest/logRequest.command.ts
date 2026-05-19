import { ICommand } from "@/application/common/interfaces/command.interface";

export interface LogRequestPayload {
	method: string;
	route: string;
	ip: string;
	statusCode: number;
	responseTimeMs: number;
	correlationId?: string;
	userId?: string;
	userAgent?: string;
}

export class LogRequestCommand implements ICommand {
	readonly type = "LogRequestCommand";

	constructor(public readonly payload: LogRequestPayload) {}
}
