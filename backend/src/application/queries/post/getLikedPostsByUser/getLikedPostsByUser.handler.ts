import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetLikedPostsByUserQuery } from "./getLikedPostsByUser.query";
import { inject, injectable } from "tsyringe";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { PaginationResult, PostDTO } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetLikedPostsByUserHandler implements IQueryHandler<
  GetLikedPostsByUserQuery,
  PaginationResult<PostDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: GetLikedPostsByUserQuery,
  ): Promise<PaginationResult<PostDTO>> {
    const { userPublicId, page, limit, viewerPublicId, sortBy, sortOrder } =
      query;

    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) {
      throw Errors.notFound("User");
    }

    const { postIds, total } =
      await this.postLikeRepository.findLikedPostIdsByUser(
        user.id,
        page,
        limit,
        sortBy,
        sortOrder,
      );

    if (postIds.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    // fetch posts by IDs
    const posts = await this.postReadRepository.findPostsByIds(
      postIds.map((id) => id.toString()),
      viewerPublicId,
    );

    // Map to DTOs
    const postDTOs = posts.map((post) => this.dtoService.toPostDTO(post));

    return {
      data: postDTOs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
