import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPostByPublicIdQuery } from "./getPostByPublicId.query";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { DTOService } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { IPost, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetPostByPublicIdQueryHandler implements IQueryHandler<
  GetPostByPublicIdQuery,
  PostDTO
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetPostByPublicIdQuery): Promise<PostDTO> {
    const post: IPost | null = await this.postReadRepository.findByPublicId(
      query.publicId,
    );
    if (!post) {
      throw Errors.notFound("Post");
    }

    const dto = this.dtoService.toPostDTO(post);

    // Check author community role
    if (post.communityId) {
      const communityInternalId =
        post.communityId instanceof mongoose.Types.ObjectId
          ? post.communityId
          : (post.communityId as { _id: mongoose.Types.ObjectId })._id; // Handle populated field if necessary

      const authorInternalId = post.author?._id || post.user;

      if (communityInternalId && authorInternalId) {
        const authorMember =
          await this.communityMemberRepository.findByCommunityAndUser(
            communityInternalId.toString(),
            authorInternalId.toString(),
          );

        if (
          authorMember &&
          (authorMember.role === "admin" || authorMember.role === "moderator")
        ) {
          dto.authorCommunityRole = authorMember.role;
        }
      }
    }

    // add viewer-specific fields if viewer is logged in
    if (query.viewerPublicId) {
      const postInternalId = post._id?.toString();
      const viewerInternalId =
        await this.userReadRepository.findInternalIdByPublicId(
          query.viewerPublicId,
        );

      if (postInternalId && viewerInternalId) {
        dto.isLikedByViewer = await this.postLikeRepository.hasUserLiked(
          postInternalId,
          viewerInternalId,
        );

        const favoriteRecord = await this.favoriteRepository.findByUserAndPost(
          viewerInternalId,
          postInternalId,
        );
        dto.isFavoritedByViewer = !!favoriteRecord;

        // Check if viewer has reposted this post (or the original if viewing a repost)
        const repostOfDoc = post.repostOf as unknown as
          | mongoose.Types.ObjectId
          | { _id: mongoose.Types.ObjectId }
          | null;
        const repostCheckTargetId =
          repostOfDoc instanceof mongoose.Types.ObjectId
            ? repostOfDoc.toString()
            : repostOfDoc && "_id" in repostOfDoc
              ? (repostOfDoc as { _id: mongoose.Types.ObjectId })._id.toString()
              : postInternalId;
        const repostCount = await this.postReadRepository.countDocuments({
          user: new mongoose.Types.ObjectId(viewerInternalId),
          repostOf: new mongoose.Types.ObjectId(repostCheckTargetId),
          type: "repost",
        });
        dto.isRepostedByViewer = repostCount > 0;

        // Check delete permission
        const isOwner = post.author.publicId === query.viewerPublicId;
        let canDelete = isOwner;

        if (!canDelete && post.communityId) {
          const communityInternalId =
            post.communityId instanceof mongoose.Types.ObjectId
              ? post.communityId
              : (post.communityId as { _id: mongoose.Types.ObjectId })._id; // Handle populated field

          if (communityInternalId) {
            const member =
              await this.communityMemberRepository.findByCommunityAndUser(
                communityInternalId.toString(),
                viewerInternalId.toString(),
              );
            if (
              member &&
              (member.role === "admin" || member.role === "moderator")
            ) {
              canDelete = true;
            }
          }
        }
        dto.canDelete = canDelete;
      }
    }

    return dto;
  }
}
