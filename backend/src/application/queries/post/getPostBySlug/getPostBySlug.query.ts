import { IQuery } from "@/application/common/interfaces/query.interface";
import type { UserPublicId } from "@/types/branded";

export class GetPostBySlugQuery implements IQuery {
	readonly type = "GetPostBySlugQuery";

	constructor(public readonly slug: string, public readonly viewerPublicId?: UserPublicId) {}
}
