import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAllUsersAdminQuery } from "./getAllUsersAdmin.query";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { PaginationResult } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetAllUsersAdminQueryHandler implements IQueryHandler<
  GetAllUsersAdminQuery,
  PaginationResult<AdminUserDTO>
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: GetAllUsersAdminQuery,
  ): Promise<PaginationResult<AdminUserDTO>> {
    const result = await this.userReadRepository.findWithPagination(
      query.options,
    );

    return {
      data: result.data.map((user) => this.dtoService.toAdminDTO(user)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }
}
