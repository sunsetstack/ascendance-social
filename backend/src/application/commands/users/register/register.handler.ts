import { inject, injectable } from "tsyringe";
import { RegisterUserCommand } from "./register.command";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { Errors, wrapError } from "@/utils/errors";
import { UserFactory } from "@/utils/user.factory";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DTOService, AuthenticatedUserDTO } from "@/services/dto.service";
import { EmailService } from "@/services/email.service";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";
import {
  USERNAME_BLOOM_KEY,
  USERNAME_BLOOM_OPTIONS,
} from "@/config/bloomConfig";
import { logger } from "@/utils/winston";

import { TOKENS } from "@/types/tokens";

export interface RegisterUserResult {
  user: AuthenticatedUserDTO;
}

@injectable()
export class RegisterUserCommandHandler implements ICommandHandler<
  RegisterUserCommand,
  RegisterUserResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Services.Email) private readonly emailService: EmailService,
    @inject(TOKENS.Services.BloomFilter)
    private readonly bloomFilterService: BloomFilterService,
  ) {}
  // Trying and keeping the logic from my current userservice method, see how it goes

  async execute(command: RegisterUserCommand): Promise<RegisterUserResult> {
    try {
      const userPayload = UserFactory.createFromRegistration({
        handle: command.handle,
        username: command.username,
        email: command.email,
        password: command.password,
        avatar: command.avatar,
        cover: command.cover,
        ip: command.ip,
      });

      const usernameMayExist = await this.usernameMayExist(userPayload.username);
      if (usernameMayExist) {
        const existingUser =
          await this.userReadRepository.findByUsername(userPayload.username);
        if (existingUser) {
          throw Errors.validation("Username is already taken");
        }
      }

      const user = await this.userWriteRepository.create(userPayload);

      await this.emailService.sendEmailVerification(
        user.email,
        userPayload.emailVerificationToken,
      );
      await this.seedUsernameBloom(userPayload.username);

      const userDTO = this.dtoService.toAuthenticatedUserDTO(user);
      return { user: userDTO };
    } catch (error) {
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("An unknown error occurred");
    }
  }

  private async usernameMayExist(username: string): Promise<boolean> {
    try {
      return await this.bloomFilterService.mightContain(
        USERNAME_BLOOM_KEY,
        username,
        USERNAME_BLOOM_OPTIONS,
      );
    } catch (error) {
      logger.warn(
        "[Bloom][username] availability pre-check failed; falling back to DB path",
        {
          username,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return true;
    }
  }

  private async seedUsernameBloom(username: string): Promise<void> {
    try {
      await this.bloomFilterService.add(
        USERNAME_BLOOM_KEY,
        username,
        USERNAME_BLOOM_OPTIONS,
      );
    } catch (error) {
      logger.warn(
        "[Bloom][username] failed to seed bloom filter after registration",
        {
          username,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
