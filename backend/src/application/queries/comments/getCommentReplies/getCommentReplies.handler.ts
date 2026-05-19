import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommentRepliesQuery } from "./getCommentReplies.query";
import { CommentService } from "@/services/comment.service";
import { TOKENS } from "@/types/tokens";
import { CommentListResult } from "@/application/comments/comment-query.types";

@injectable()
export class GetCommentRepliesQueryHandler implements IQueryHandler<
  GetCommentRepliesQuery,
  CommentListResult
> {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
  ) {}

  async execute(query: GetCommentRepliesQuery): Promise<CommentListResult> {
    return this.commentService.getCommentReplies(
      query.commentId,
      query.page,
      query.limit,
    );
  }
}
