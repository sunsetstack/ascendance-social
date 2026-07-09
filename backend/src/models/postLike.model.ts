import { Schema, model } from "mongoose";
import { IPostLike } from "@/types";

const postLikeSchema = new Schema<IPostLike>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
postLikeSchema.index({ userId: 1, createdAt: -1 });

const PostLike = model<IPostLike>("PostLike", postLikeSchema);
export default PostLike;
