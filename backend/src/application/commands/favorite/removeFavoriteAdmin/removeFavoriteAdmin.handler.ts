import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RemoveFavoriteAdminCommand } from "./removeFavoriteAdmin.command";
import { UnitOfWork } from "@/database/UnitOfWork";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import type { IPostReadRepository, IUserReadRepository } from "@/repositories/interfaces";
import { Errors, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class RemoveFavoriteAdminCommandHandler implements ICommandHandler<
  RemoveFavoriteAdminCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postRepository: IPostReadRepository,
  ) {}

  async execute(command: RemoveFavoriteAdminCommand): Promise<void> {
    try {
      const { userPublicId, postPublicId } = command;

      const userId =
        await this.userReadRepository.findInternalIdByPublicId(userPublicId);
      if (!userId) {
        throw Errors.notFound("User", userPublicId);
      }

      const postId =
        await this.postRepository.findInternalIdByPublicId(postPublicId);
      if (!postId) {
        throw Errors.notFound("Post", postPublicId);
      }

      await this.unitOfWork.executeInTransaction(async () => {
        await this.favoriteRepository.remove(userId, postId);
      });
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: {
          operation: "removeFavoriteAdmin",
          userPublicId: command.userPublicId,
          postPublicId: command.postPublicId,
        },
      });
    }
  }
}
