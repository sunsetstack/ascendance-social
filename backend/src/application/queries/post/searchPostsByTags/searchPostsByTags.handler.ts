import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { SearchPostsByTagsQuery } from "./searchPostsByTags.query";
import type { IPostReadRepository } from "@/repositories/interfaces";
import { TagService } from "@/services/tag.service";
import { DTOService } from "@/services/dto.service";
import { PaginationResult, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class SearchPostsByTagsQueryHandler implements IQueryHandler<
  SearchPostsByTagsQuery,
  PaginationResult<PostDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.Tag) private readonly tagService: TagService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: SearchPostsByTagsQuery,
  ): Promise<PaginationResult<PostDTO>> {
    // if no tags provided, return all posts
    if (query.tags.length === 0) {
      const result = await this.postReadRepository.findWithPagination({
        page: query.page,
        limit: query.limit,
      });
      return {
        ...result,
        data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
      };
    }

    const tagIds = await this.tagService.resolveTagIds(query.tags);
    const result = await this.postReadRepository.findByTags(tagIds, {
      page: query.page,
      limit: query.limit,
    });

    return {
      ...result,
      data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
    };
  }
}
