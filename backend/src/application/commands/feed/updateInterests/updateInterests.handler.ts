import { inject, injectable } from "tsyringe";
import type { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { isInterestId } from "@/services/feed/interests.policy";
import { UpdateInterestsCommand } from "./updateInterests.command";

@injectable()
export class UpdateInterestsCommandHandler implements ICommandHandler<UpdateInterestsCommand, void> {
  constructor(
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.FeedPreference) private readonly preferences: FeedPreferenceRepository,
    @inject(TOKENS.Repositories.UnitOfWork) private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(command: UpdateInterestsCommand): Promise<void> {
    if (command.selected.some((id) => !isInterestId(id))) throw Errors.validation("Unknown interest");
    const user = await this.users.findByPublicId(asUserPublicId(command.userPublicId));
    if (!user) throw Errors.notFound("User");
    await this.unitOfWork.executeInTransaction(async () => {
      if (command.action === "reset") await this.preferences.reset(String(user._id));
      else await this.preferences.select(String(user._id), [...new Set(command.selected)].sort());
    });
  }
}
