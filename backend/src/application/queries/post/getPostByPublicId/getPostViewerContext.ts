import mongoose from "mongoose";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { IPost, UserPublicId } from "@/types";
import {
  getCommunityInternalId,
  getRepostTargetId,
} from "./getPostByPublicId.helpers";

export interface PostViewerContext {
  isLikedByViewer: boolean;
  isFavoritedByViewer: boolean;
  isRepostedByViewer: boolean;
  canDelete: boolean;
}

interface ViewerContextDeps {
  postReadRepository: Pick<IPostReadRepository, "countDocuments">;
  userReadRepository: Pick<IUserReadRepository, "findInternalIdByPublicId">;
  favoriteRepository: Pick<FavoriteRepository, "findByUserAndPost">;
  postLikeRepository: Pick<PostLikeRepository, "hasUserLiked">;
  communityMemberRepository: Pick<
    CommunityMemberRepository,
    "findByCommunityAndUser"
  >;
}

export async function buildPostViewerContext(
  post: IPost,
  viewerPublicId: UserPublicId,
  deps: ViewerContextDeps,
): Promise<PostViewerContext | null> {
  const postInternalId = post._id?.toString();
  if (!postInternalId) {
    return null;
  }

  const viewerInternalId =
    await deps.userReadRepository.findInternalIdByPublicId(viewerPublicId);
  if (!viewerInternalId) {
    return null;
  }

  const [isLikedByViewer, favoriteRecord, repostCount] = await Promise.all([
    deps.postLikeRepository.hasUserLiked(postInternalId, viewerInternalId),
    deps.favoriteRepository.findByUserAndPost(viewerInternalId, postInternalId),
    deps.postReadRepository.countDocuments({
      user: new mongoose.Types.ObjectId(viewerInternalId),
      repostOf: new mongoose.Types.ObjectId(
        getRepostTargetId(post, postInternalId),
      ),
      type: "repost",
    }),
  ]);

  const isOwner = post.author.publicId === viewerPublicId;
  const canDelete = isOwner
    ? true
    : await canViewerModeratePost(post, viewerInternalId, deps);

  return {
    isLikedByViewer,
    isFavoritedByViewer: !!favoriteRecord,
    isRepostedByViewer: repostCount > 0,
    canDelete,
  };
}

async function canViewerModeratePost(
  post: IPost,
  viewerInternalId: string,
  deps: Pick<ViewerContextDeps, "communityMemberRepository">,
): Promise<boolean> {
  const communityInternalId = getCommunityInternalId(post);
  if (!communityInternalId) {
    return false;
  }

  const member = await deps.communityMemberRepository.findByCommunityAndUser(
    communityInternalId,
    viewerInternalId,
  );

  return !!member && (member.role === "admin" || member.role === "moderator");
}
