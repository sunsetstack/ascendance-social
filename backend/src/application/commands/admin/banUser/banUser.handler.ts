import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { BanUserCommand } from "./banUser.command";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

export interface BanUserResult {
  message: string;
  user: AdminUserDTO;
}

@injectable()
export class BanUserCommandHandler implements ICommandHandler<
  BanUserCommand,
  BanUserResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: BanUserCommand): Promise<BanUserResult> {
    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const adminInternalId =
      await this.userReadRepository.findInternalIdByPublicId(
        command.adminPublicId,
      );
    if (!adminInternalId) {
      throw Errors.notFound("User");
    }

    const updatedUser = await this.userWriteRepository.update(user.id, {
      isBanned: true,
      bannedAt: new Date(),
      bannedReason: command.reason,
      bannedBy: adminInternalId,
    });

    if (!updatedUser) {
      throw Errors.internal("Failed to update user during ban");
    }

    return {
      message: "User banned successfully",
      user: this.dtoService.toAdminDTO(updatedUser),
    };
  }
}
