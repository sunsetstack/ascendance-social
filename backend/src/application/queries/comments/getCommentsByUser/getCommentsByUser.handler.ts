import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommentsByUserQuery } from "./getCommentsByUser.query";
import { CommentService } from "@/services/comment.service";
import { TOKENS } from "@/types/tokens";
import { CommentListResult } from "@/application/comments/comment-query.types";

@injectable()
export class GetCommentsByUserQueryHandler implements IQueryHandler<
  GetCommentsByUserQuery,
  CommentListResult
> {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
  ) {}

  async execute(query: GetCommentsByUserQuery): Promise<CommentListResult> {
    return this.commentService.getCommentsByUserPublicId(
      query.userPublicId,
      query.page,
      query.limit,
      query.sortBy,
      query.sortOrder,
    );
  }
}
