import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { AddFavoriteCommand } from "./addFavorite.command";
import { UnitOfWork } from "@/database/UnitOfWork";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import type { IPostReadRepository, IUserReadRepository } from "@/repositories/interfaces";
import { IFavorite } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

@injectable()
export class AddFavoriteCommandHandler implements ICommandHandler<
  AddFavoriteCommand,
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

  async execute(command: AddFavoriteCommand): Promise<void> {
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
        const existing = await this.favoriteRepository.findByUserAndPost(
          actorId,
          postId,
        );
        if (existing) {
          throw Errors.duplicate("Post already in favorites");
        }

        const favoriteData: Partial<IFavorite> = {
          userId: new mongoose.Types.ObjectId(actorId),
          postId: new mongoose.Types.ObjectId(postId),
        };
        await this.favoriteRepository.create(favoriteData);
      });
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: {
          operation: "addFavorite",
          actorPublicId: command.actorPublicId,
          postPublicId: command.postPublicId,
        },
      });
    }
  }
}
