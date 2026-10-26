export interface FeedPreviewDefinition {
  topics: string[];
  sort: "latest" | "relevant";
  includeReposts: boolean;
}
