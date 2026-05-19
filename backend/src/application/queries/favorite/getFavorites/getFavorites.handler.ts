import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetFavoritesQuery } from "./getFavorites.query";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { IPost, PaginationResult, PostDTO } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetFavoritesQueryHandler
  implements IQueryHandler<GetFavoritesQuery, PaginationResult<PostDTO>>
{
  constructor(
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetFavoritesQuery): Promise<PaginationResult<PostDTO>> {
    try {
      const { viewerPublicId, page = 1, limit = 10 } = query;

      const userId = await this.userReadRepository.findInternalIdByPublicId(viewerPublicId);
      if (!userId) {
        throw Errors.notFound("User", viewerPublicId);
      }

      const safePage = Math.max(1, Number(page));
      const safeLimit = Math.max(1, Number(limit));
      const { data, total } = await this.favoriteRepository.findFavoritesByUserId(
        userId,
        safePage,
        safeLimit,
      );

      const dtos = data.map((post) => {
        const plain = this.ensurePlain(post) as IPost & Record<string, unknown>;
        plain.isFavoritedByViewer = true;
        if (plain.isLikedByViewer === undefined) {
          plain.isLikedByViewer = false;
        }
        return this.dtoService.toPostDTO(plain);
      });

      return {
        data: dtos,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: { operation: "getFavoritesForViewer", viewerPublicId: query.viewerPublicId },
      });
    }
  }

  private ensurePlain(entry: IPost): IPost & Record<string, unknown> {
    if (
      entry &&
      typeof (entry as IPost & { toObject?: () => IPost }).toObject ===
        "function"
    ) {
      return (entry as IPost & { toObject: () => IPost }).toObject() as IPost &
        Record<string, unknown>;
    }
    return entry as IPost & Record<string, unknown>;
  }
}
