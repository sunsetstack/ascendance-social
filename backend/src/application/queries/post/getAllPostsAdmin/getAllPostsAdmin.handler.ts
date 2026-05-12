import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAllPostsAdminQuery } from "./getAllPostsAdmin.query";
import type { IPostReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { PaginationResult, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetAllPostsAdminQueryHandler implements IQueryHandler<
  GetAllPostsAdminQuery,
  PaginationResult<PostDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: GetAllPostsAdminQuery,
  ): Promise<PaginationResult<PostDTO>> {
    const { page, limit, sortBy = "createdAt", sortOrder = "desc" } = query;

    const result = await this.postReadRepository.findWithPagination({
      page,
      limit,
      sortBy,
      sortOrder,
    });

    return {
      data: result.data.map((post) => this.dtoService.toPostDTO(post)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
