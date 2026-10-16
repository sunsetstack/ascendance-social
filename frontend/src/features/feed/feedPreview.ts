export interface FeedPreviewDefinition {
  topics: string[];
  sort: "latest" | "relevant";
  includeReposts: boolean;
}

export const defaultFeedPreview: FeedPreviewDefinition = {
  topics: [], sort: "latest", includeReposts: true,
};

export function readFeedPreview(params: URLSearchParams): {
  definition: FeedPreviewDefinition;
  valid: boolean;
} {
  const rawTopics = params.getAll("topic");
  const sort = params.get("sort") ?? "latest";
  const reposts = params.get("reposts") ?? "show";
  const topics = [...new Set(rawTopics.map((topic) => topic.trim().toLowerCase()))].sort();
  return {
    definition: { topics, sort: sort === "relevant" ? "relevant" : "latest", includeReposts: reposts !== "hide" },
    valid: rawTopics.length <= 5 && topics.every((topic) =>
      topic.length > 0 && topic.length <= 64 && /^[\p{L}\p{N}_]+$/u.test(topic),
    ) && ["latest", "relevant"].includes(sort) && ["show", "hide"].includes(reposts)
      && params.getAll("sort").length <= 1 && params.getAll("reposts").length <= 1,
  };
}

export function writeFeedPreview(
  current: URLSearchParams,
  definition: FeedPreviewDefinition,
): URLSearchParams {
  const params = new URLSearchParams(current);
  params.set("feed", "custom");
  params.delete("topic");
  for (const topic of [...new Set(definition.topics)].sort()) params.append("topic", topic);
  params.delete("sort");
  if (definition.sort !== "latest") params.set("sort", definition.sort);
  params.delete("reposts");
  if (!definition.includeReposts) params.set("reposts", "hide");
  return params;
}
