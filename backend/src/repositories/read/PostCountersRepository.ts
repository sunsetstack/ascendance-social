import { inject, injectable } from "tsyringe";
import type { Model } from "mongoose";
import type { IPost } from "@/types";
import type {
  PostCounters,
  PostCounterSnapshot,
} from "@/application/ports/post-counters";
import { TOKENS } from "@/types/tokens";
import { handleMongoError } from "@/utils/errors";

@injectable()
export class PostCountersRepository implements PostCounters {
  private readonly inFlight = new Map<
    string,
    Promise<PostCounterSnapshot | null>
  >();

  constructor(
    @inject(TOKENS.Models.Post) private readonly posts: Model<IPost>,
  ) {}

  async getPostMetadata(
    ids: readonly string[],
  ): Promise<(PostCounterSnapshot | null)[]> {
    if (ids.length === 0) return [];
    const missing = [...new Set(ids)].filter((id) => !this.inFlight.has(id));
    if (missing.length > 0) {
      const batch = this.readCounters(missing);
      for (const id of missing) {
        const result = batch
          .then((counters) => counters.get(id) ?? null)
          .finally(() => {
            this.inFlight.delete(id);
          });
        this.inFlight.set(id, result);
      }
    }
    return Promise.all(ids.map((id) => this.inFlight.get(id)!));
  }

  private async readCounters(
    ids: readonly string[],
  ): Promise<Map<string, PostCounterSnapshot>> {
    try {
      const posts = await this.posts
        .find({ publicId: { $in: ids } })
        .select(
          "publicId likesCount likesRevision commentsCount viewsCount -_id",
        )
        .lean()
        .exec();
      return new Map(
        posts.map((post) => [
          post.publicId as string,
          {
            likes: post.likesCount ?? 0,
            likesRevision: post.likesRevision ?? 0,
            commentsCount: post.commentsCount ?? 0,
            viewsCount: post.viewsCount ?? 0,
          },
        ]),
      );
    } catch (error) {
      handleMongoError(error);
    }
  }
}
