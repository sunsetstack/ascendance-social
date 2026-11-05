export interface PostCounterSnapshot {
  likes: number;
  likesRevision: number;
  commentsCount: number;
  viewsCount: number;
}

export interface PostCounters {
  getPostMetadata(
    postPublicIds: readonly string[],
  ): Promise<(PostCounterSnapshot | null)[]>;
}
