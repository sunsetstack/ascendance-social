import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetHandleSuggestionsQuery } from "./getHandleSuggestions.query";
import { inject, injectable } from "tsyringe";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { DTOService, HandleSuggestionDTO } from "@/services/dto.service";
import { Errors, wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { FollowRepository } from "@/repositories/follow.repository";
import { escapeRegex } from "@/utils/sanitizers";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";

const DEFAULT_LIMIT = 8;
const TRENDING_FALLBACK_LIMIT = 20;

@injectable()
export class GetHandleSuggestionsQueryHandler implements IQueryHandler<
  GetHandleSuggestionsQuery,
  HandleSuggestionDTO[]
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
  ) {}

  async execute(
    query: GetHandleSuggestionsQuery,
  ): Promise<HandleSuggestionDTO[]> {
    try {
      const limit = this.resolveLimit(query.limit);
      const normalizedQuery = query.query.trim();

      // For empty query, match everything (or top results)
      // escapeRegex returns empty string if input is empty, so ^ matches start of string
      const handleRegex = new RegExp(`^${escapeRegex(normalizedQuery)}`, "i");

      if (query.context === "mention") {
        return this.getMentionSuggestions(
          handleRegex,
          limit,
          normalizedQuery.length,
          query.viewerPublicId,
        );
      }

      return this.getSearchSuggestions(handleRegex, limit);
    } catch (error) {
      logger.error("[HandleSuggestions] Failed to fetch suggestions", error);
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("Failed to fetch handle suggestions");
    }
  }

  private resolveLimit(limit?: number): number {
    if (!limit || !Number.isFinite(limit) || limit <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(limit, 20);
  }

  private async getMentionSuggestions(
    handleRegex: RegExp,
    limit: number,
    queryLength: number,
    viewerPublicId?: string,
  ): Promise<HandleSuggestionDTO[]> {
    if (viewerPublicId) {
      const relatedMatches = await this.loadRelatedMatches(
        viewerPublicId,
        handleRegex,
        limit,
      );
      if (relatedMatches.length > 0) {
        const filtered = this.filterOutViewer(relatedMatches, viewerPublicId);
        return this.mapToDTO(this.sortAlphabeticallyDesc(filtered));
      }
    }

    // Requirement: "If nothing is found there, show the most trending/hot users...
    // after the users writes the first 3 letters"
    if (queryLength >= 3) {
      const trendingMatches = await this.getPopularMatches(
        handleRegex,
        TRENDING_FALLBACK_LIMIT,
      );
      const filtered = viewerPublicId
        ? this.filterOutViewer(trendingMatches, viewerPublicId)
        : trendingMatches;
      return this.mapToDTO(
        this.sortAlphabeticallyDesc(filtered).slice(0, limit),
      );
    }

    return [];
  }

  private async getSearchSuggestions(
    handleRegex: RegExp,
    limit: number,
  ): Promise<HandleSuggestionDTO[]> {
    // Requirement: "in the search bar, start with most popular handles"
    const popularMatches = await this.getPopularMatches(
      handleRegex,
      TRENDING_FALLBACK_LIMIT,
    );
    return this.mapToDTO(
      this.sortAlphabeticallyDesc(popularMatches).slice(0, limit),
    );
  }

  private async loadRelatedMatches(
    viewerPublicId: string,
    handleRegex: RegExp,
    limit: number,
  ) {
    const user = await this.userReadRepository.findByPublicId(viewerPublicId);
    if (!user?._id) {
      return [];
    }

    const [followerIds, followingIds] = await Promise.all([
      this.followRepository.getFollowerObjectIds(String(user._id)),
      this.followRepository.getFollowingObjectIds(String(user._id)),
    ]);
    const relatedIds = Array.from(new Set([...followerIds, ...followingIds]));
    if (relatedIds.length === 0) {
      return [];
    }

    const result = await this.userReadRepository.findWithPagination({
      page: 1,
      limit,
      sortBy: "handleNormalized",
      sortOrder: "desc",
      filter: {
        _id: { $in: relatedIds },
        isBanned: false,
        handleNormalized: { $regex: handleRegex },
      },
    });
    return result.data;
  }

  private async getPopularMatches(handleRegex: RegExp, limit: number) {
    const result = await this.userReadRepository.findWithPagination({
      page: 1,
      limit,
      sortBy: "followerCount",
      sortOrder: "desc",
      filter: {
        isBanned: false,
        handleNormalized: { $regex: handleRegex },
      },
    });
    return result.data;
  }

  private sortAlphabeticallyDesc<T extends { handle: string }>(
    users: T[],
  ): T[] {
    return [...users].sort((left, right) =>
      right.handle.toLowerCase().localeCompare(left.handle.toLowerCase()),
    );
  }

  private filterOutViewer<T extends { publicId: string }>(
    users: T[],
    viewerPublicId: string,
  ): T[] {
    return users.filter((user) => user.publicId !== viewerPublicId);
  }

  private mapToDTO(users: IUser[]): HandleSuggestionDTO[] {
    return users.map((user) => this.dtoService.toHandleSuggestionDTO(user));
  }
}
