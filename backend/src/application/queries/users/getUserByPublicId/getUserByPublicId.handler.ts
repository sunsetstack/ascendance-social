import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUserByPublicIdQuery } from "./getUserByPublicId.query";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { DTOService, PublicUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetUserByPublicIdQueryHandler implements IQueryHandler<
  GetUserByPublicIdQuery,
  PublicUserDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetUserByPublicIdQuery): Promise<PublicUserDTO> {
    const user = await this.userReadRepository.findByPublicId(query.publicId);
    if (!user) {
      throw Errors.notFound("User");
    }

    return this.dtoService.toPublicDTO(user);
  }
}
