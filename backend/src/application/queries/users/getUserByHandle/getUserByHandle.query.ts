import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetUserByHandleQuery implements IQuery {
	readonly type = "GetUserByHandleQuery";

	constructor(public readonly handle: string) {}
}
