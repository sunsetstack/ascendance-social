import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DemoteFromAdminCommand } from "./demoteFromAdmin.command";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { AdminRemovalGuardService } from "@/services/admin-removal-guard.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class DemoteFromAdminCommandHandler implements ICommandHandler<
  DemoteFromAdminCommand,
  AdminUserDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Services.AdminRemovalGuard)
    private readonly adminRemovalGuard: AdminRemovalGuardService,
  ) {}

  async execute(command: DemoteFromAdminCommand): Promise<AdminUserDTO> {
    if (!command.adminPublicId) {
      throw Errors.authentication("Admin user is required");
    }

    return await this.unitOfWork.executeInTransaction(async () => {
      const user = await this.userReadRepository.findByPublicId(
        command.userPublicId,
      );
      if (!user) {
        throw Errors.notFound("User");
      }

      if (!user.isAdmin) {
        throw Errors.validation("User is not an admin");
      }

      if (command.adminPublicId === user.publicId) {
        throw Errors.validation("Administrators cannot demote themselves");
      }

      await this.adminRemovalGuard.touch();
      if (!user.isBanned) {
        const activeAdminCount = await this.userReadRepository.countDocuments({
          isAdmin: true,
          isBanned: false,
        });
        if (activeAdminCount <= 1) {
          throw Errors.validation(
            "At least one active administrator must remain",
          );
        }
      }

      const updatedUser = await this.userWriteRepository.update(user.id, {
        isAdmin: false,
      });
      if (!updatedUser) {
        throw Errors.internal("Failed to update user during demotion");
      }

      return this.dtoService.toAdminDTO(updatedUser);
    });
  }
}
