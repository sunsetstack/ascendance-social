import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { VerifyEmailCommand } from "./VerifyEmailCommand";
import { Errors } from "@/utils/errors";
import type {
  IUserReadRepository,
  IUserWriteRepository,
} from "@/repositories/interfaces";
import {
  DTOService,
  AdminUserDTO,
  AuthenticatedUserDTO,
} from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";

export type VerifyEmailResult = AdminUserDTO | AuthenticatedUserDTO;

@injectable()
export class VerifyEmailHandler implements ICommandHandler<
  VerifyEmailCommand,
  VerifyEmailResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: VerifyEmailCommand): Promise<VerifyEmailResult> {
    const user = await this.userReadRepository.findByEmailVerificationToken(
      command.email,
      command.token,
    );
    if (!user) {
      throw Errors.validation("Invalid or expired verification token");
    }

    if (user.isEmailVerified) {
      return user.isAdmin
        ? this.dtoService.toAdminDTO(user)
        : this.dtoService.toAuthenticatedUserDTO(user);
    }

    const updatedUser = await this.userWriteRepository.update(user.id, {
      $set: { isEmailVerified: true },
      $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 },
    });

    if (!updatedUser) {
      throw Errors.database("Failed to verify email");
    }

    return updatedUser.isAdmin
      ? this.dtoService.toAdminDTO(updatedUser)
      : this.dtoService.toAuthenticatedUserDTO(updatedUser);
  }
}
