import type { IQuery } from "@/application/common/interfaces/query.interface";
import type { FeedPreviewDefinition } from "@/types/customFeeds/feed-preview.types";

export class GetFeedPreviewQuery implements IQuery {
  readonly type = "GetFeedPreviewQuery";

  constructor(
    public readonly definition: FeedPreviewDefinition,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}
