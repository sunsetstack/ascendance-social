import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnbanUserCommand } from "./unbanUser.command";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UnbanUserCommandHandler implements ICommandHandler<
  UnbanUserCommand,
  AdminUserDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: UnbanUserCommand): Promise<AdminUserDTO> {
    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const updatedUser = await this.userWriteRepository.update(user.id, {
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      bannedBy: null,
    });

    if (!updatedUser) {
      throw Errors.internal("Failed to update user during unban");
    }

    return this.dtoService.toAdminDTO(updatedUser);
  }
}
