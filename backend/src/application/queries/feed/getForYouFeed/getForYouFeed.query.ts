import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetForYouFeedQuery implements IQuery {
	readonly type = "GetForYouFeedQuery";
	constructor(
		public readonly userId: string,
		public readonly page: number,
		public readonly limit: number,
		public readonly cursor?: string,
    public readonly destination: "home" | "for-you" = "for-you",
	) {}
}
