import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { RemoveFavoriteCommand } from "./removeFavorite.command";
import { UnitOfWork } from "@/database/UnitOfWork";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import type { IPostReadRepository, IUserReadRepository } from "@/repositories/interfaces";
import { Errors, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class RemoveFavoriteCommandHandler implements ICommandHandler<
  RemoveFavoriteCommand,
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

  async execute(command: RemoveFavoriteCommand): Promise<void> {
    try {
      const { actorPublicId, postPublicId } = command;

      const [actorId, postId] = await Promise.all([
        this.userReadRepository.findInternalIdByPublicId(actorPublicId),
        this.postRepository.findInternalIdByPublicId(postPublicId),
      ]);

      if (!actorId) {
        throw Errors.notFound("User", actorPublicId);
      }
      if (!postId) {
        throw Errors.notFound("Post", postPublicId);
      }

      await this.unitOfWork.executeInTransaction(async () => {
        const wasRemoved = await this.favoriteRepository.remove(
          actorId,
          postId,
        );
        if (!wasRemoved) {
          throw Errors.notFound("Favorite", `${actorId}-${postId}`);
        }
      });
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: {
          operation: "removeFavorite",
          actorPublicId: command.actorPublicId,
          postPublicId: command.postPublicId,
        },
      });
    }
  }
}
