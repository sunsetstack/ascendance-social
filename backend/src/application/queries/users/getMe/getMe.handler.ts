import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetMeQuery } from "@/application/queries/users/getMe/getMe.query";
import { inject, injectable } from "tsyringe";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { Errors, wrapError } from "@/utils/errors";
import {
  DTOService,
  AdminUserDTO,
  AuthenticatedUserDTO,
} from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";

export interface GetMeResult {
  user: AdminUserDTO | AuthenticatedUserDTO;
}

@injectable()
export class GetMeQueryHandler implements IQueryHandler<
  GetMeQuery,
  GetMeResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetMeQuery): Promise<GetMeResult> {
    try {
      const user = await this.userReadRepository.findByPublicId(query.publicId);
      if (!user) {
        throw Errors.notFound("User");
      }

      // return admin DTO for admin users, authenticated DTO for regular users
      const userDTO = user.isAdmin
        ? this.dtoService.toAdminDTO(user)
        : this.dtoService.toAuthenticatedUserDTO(user);

      return { user: userDTO };
    } catch (error) {
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("An unknown error occurred");
    }
  }
}
