import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPostBySlugQuery } from "./getPostBySlug.query";
import type { IPostReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetPostBySlugQueryHandler implements IQueryHandler<
  GetPostBySlugQuery,
  PostDTO
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetPostBySlugQuery): Promise<PostDTO> {
    const post = await this.postReadRepository.findBySlug(query.slug);
    if (!post) {
      throw Errors.notFound("Post");
    }
    return this.dtoService.toPostDTO(post);
  }
}
