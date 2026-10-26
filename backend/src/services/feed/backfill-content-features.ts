import type { Model } from "mongoose";
import type { IPost, ITag } from "@/types";
import { classifyContent, classifyRepostContent, INTEREST_POLICY_VERSION } from "./interests.policy";

export async function backfillContentFeatures(posts: Model<IPost>, tags: Model<ITag>, apply: boolean): Promise<number> {
  const catalogue = await tags.find({}).select("tag").lean().exec();
  const tagNames = new Map(catalogue.map((tag) => [String(tag._id), tag.tag]));
  let count = 0;
  for (const type of ["original", "repost"] as const) {
    const cursor = posts.find({
      ...(type === "original" ? { $or: [{ type: "original" }, { type: { $exists: false } }] } : { type }),
      "contentFeatures.version": { $ne: INTEREST_POLICY_VERSION },
    }).sort({ createdAt: 1, _id: 1 }).cursor();
    for await (const post of cursor) {
      let features = classifyContent(post.body ?? "", post.tags.map((id) => tagNames.get(String(id))).filter((tag): tag is string => !!tag), Boolean(post.image));
      if (post.repostOf) {
        const original = await posts.findById(post.repostOf).select("body tags image contentFeatures").lean().exec();
        if (original) features = classifyRepostContent(post.body ?? "", Boolean(post.image), original.contentFeatures ?? classifyContent(original.body ?? "", original.tags.map((id) => tagNames.get(String(id))).filter((tag): tag is string => !!tag), Boolean(original.image)));
      }
      if (apply) await posts.updateOne({ _id: post._id, "contentFeatures.version": { $ne: INTEREST_POLICY_VERSION } }, { $set: { contentFeatures: features } }).exec();
      count += 1;
    }
  }
  return count;
}
