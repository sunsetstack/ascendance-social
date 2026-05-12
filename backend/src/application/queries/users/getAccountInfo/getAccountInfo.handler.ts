import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAccountInfoQuery } from "./getAccountInfo.query";
import { inject, injectable } from "tsyringe";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { Errors } from "@/utils/errors";
import { DTOService, AccountInfoDTO } from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";

export interface GetAccountInfoResult {
  accountInfo: AccountInfoDTO;
}

@injectable()
export class GetAccountInfoQueryHandler implements IQueryHandler<
  GetAccountInfoQuery,
  GetAccountInfoResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetAccountInfoQuery): Promise<GetAccountInfoResult> {
    const user = await this.userReadRepository.findByPublicId(
      query.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    return {
      accountInfo: this.dtoService.toAccountInfoDTO(user),
    };
  }
}
