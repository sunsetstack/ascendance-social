import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAdminUserProfileQuery } from "./getAdminUserProfile.query";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetAdminUserProfileQueryHandler implements IQueryHandler<
  GetAdminUserProfileQuery,
  AdminUserDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetAdminUserProfileQuery): Promise<AdminUserDTO> {
    const user = await this.userReadRepository.findByPublicId(query.publicId);
    if (!user) {
      throw Errors.notFound("User");
    }

    return this.dtoService.toAdminDTO(user);
  }
}
