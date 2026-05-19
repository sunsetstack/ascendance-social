import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommentsByPostQuery } from "./getCommentsByPost.query";
import { CommentService } from "@/services/comment.service";
import { TOKENS } from "@/types/tokens";
import { CommentListResult } from "@/application/comments/comment-query.types";

@injectable()
export class GetCommentsByPostQueryHandler implements IQueryHandler<
  GetCommentsByPostQuery,
  CommentListResult
> {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
  ) {}

  async execute(query: GetCommentsByPostQuery): Promise<CommentListResult> {
    return this.commentService.getCommentsByPostPublicId(
      query.postPublicId,
      query.page,
      query.limit,
      query.parentId,
    );
  }
}
