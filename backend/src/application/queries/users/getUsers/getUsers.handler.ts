import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUsersQuery } from "./getUsers.query";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { DTOService, PublicUserDTO } from "@/services/dto.service";
import { PaginationResult } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetUsersQueryHandler implements IQueryHandler<
  GetUsersQuery,
  PaginationResult<PublicUserDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: GetUsersQuery,
  ): Promise<PaginationResult<PublicUserDTO>> {
    const result = await this.userReadRepository.findWithPagination(
      query.options,
    );

    return {
      data: result.data.map((user) => this.dtoService.toPublicDTO(user)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
