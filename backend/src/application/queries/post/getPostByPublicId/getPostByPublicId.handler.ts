import { inject, injectable } from "tsyringe";
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
import { getPostAuthorCommunityRole } from "./getPostAuthorCommunityRole";
import { buildPostViewerContext } from "./getPostViewerContext";
import type { UserPublicId } from "@/types/branded";

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

    return this.toViewerDTO(post, query.viewerPublicId);
  }

  async toViewerDTO(post: IPost, viewerPublicId?: UserPublicId): Promise<PostDTO> {
    const dto = this.dtoService.toPostDTO(post);

    const authorCommunityRole = await getPostAuthorCommunityRole(
      post,
      this.communityMemberRepository,
    );
    if (authorCommunityRole) {
      dto.authorCommunityRole = authorCommunityRole;
    }

    if (viewerPublicId) {
      const viewerContext = await buildPostViewerContext(
        post,
        viewerPublicId,
        {
          postReadRepository: this.postReadRepository,
          userReadRepository: this.userReadRepository,
          favoriteRepository: this.favoriteRepository,
          postLikeRepository: this.postLikeRepository,
          communityMemberRepository: this.communityMemberRepository,
        },
      );

      if (viewerContext) {
        Object.assign(dto, viewerContext);
      }
    }

    return dto;
  }
}
