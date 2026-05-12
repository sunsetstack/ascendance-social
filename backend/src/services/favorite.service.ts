import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { UserRepository } from "@/repositories/user.repository";
import { PostRepository } from "@/repositories/post.repository";
import { DTOService } from "./dto.service";
import { IFavorite, IPost, PaginationResult, PostDTO } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FavoriteService {
  constructor(
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.Post)
    private readonly postRepository: PostRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async addFavorite(userId: string, postId: string): Promise<void> {
    return this.unitOfWork.executeInTransaction(async () => {
      const existing = await this.favoriteRepository.findByUserAndPost(
        userId,
        postId,
      );
      if (existing) {
        throw Errors.duplicate("Post already in favorites");
      }

      const favoriteData: Partial<IFavorite> = {
        userId: new mongoose.Types.ObjectId(userId),
        postId: new mongoose.Types.ObjectId(postId),
      };
      await this.favoriteRepository.create(favoriteData);
    });
  }

  async removeFavorite(userId: string, postId: string): Promise<void> {
    return this.unitOfWork.executeInTransaction(async () => {
      const wasRemoved = await this.favoriteRepository.remove(userId, postId);
      if (!wasRemoved) {
        throw Errors.notFound("Favorite not found");
      }
    });
  }

  async addFavoriteByPublicIds(
    actorPublicId: string,
    postPublicId: string,
  ): Promise<void> {
    const [actorId, postId] = await Promise.all([
      this.userRepository.findInternalIdByPublicId(actorPublicId),
      this.postRepository.findInternalIdByPublicId(postPublicId),
    ]);
    if (!actorId) {
      throw Errors.notFound("User not found");
    }
    if (!postId) {
      throw Errors.notFound("Post not found");
    }

    await this.addFavorite(actorId, postId);
  }

  async removeFavoriteByPublicIds(
    actorPublicId: string,
    postPublicId: string,
  ): Promise<void> {
    const [actorId, postId] = await Promise.all([
      this.userRepository.findInternalIdByPublicId(actorPublicId),
      this.postRepository.findInternalIdByPublicId(postPublicId),
    ]);
    if (!actorId) {
      throw Errors.notFound("User not found");
    }
    if (!postId) {
      throw Errors.notFound("Post not found");
    }

    await this.removeFavorite(actorId, postId);
  }

  async removeFavoriteAdmin(
    userPublicId: string,
    postPublicId: string,
  ): Promise<void> {
    const userId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userId) {
      throw Errors.notFound("User not found");
    }

    const postId =
      await this.postRepository.findInternalIdByPublicId(postPublicId);
    if (!postId) {
      throw Errors.notFound("Post not found");
    }

    return this.unitOfWork.executeInTransaction(async () => {
      await this.favoriteRepository.remove(userId, postId);
    });
  }

  async getFavoritesForViewer(
    viewerPublicId: string,
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    const userId =
      await this.userRepository.findInternalIdByPublicId(viewerPublicId);
    if (!userId) {
      throw Errors.notFound("User not found");
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const { data, total } = await this.favoriteRepository.findFavoritesByUserId(
      userId,
      safePage,
      safeLimit,
    );

    const dtos = data.map((post) => {
      const plain = this.ensurePlain(post) as IPost & Record<string, unknown>;
      plain.isFavoritedByViewer = true;
      if (plain.isLikedByViewer === undefined) {
        plain.isLikedByViewer = false;
      }
      return this.dtoService.toPostDTO(plain);
    });

    return {
      data: dtos,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  private ensurePlain(entry: IPost): IPost & Record<string, unknown> {
    if (
      entry &&
      typeof (entry as IPost & { toObject?: () => IPost }).toObject ===
        "function"
    ) {
      return (entry as IPost & { toObject: () => IPost }).toObject() as IPost &
        Record<string, unknown>;
    }
    return entry as IPost & Record<string, unknown>;
  }
}
