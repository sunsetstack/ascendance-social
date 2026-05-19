import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommentThreadQuery } from "./getCommentThread.query";
import { CommentService } from "@/services/comment.service";
import { TOKENS } from "@/types/tokens";
import { CommentThreadResult } from "@/application/comments/comment-query.types";

@injectable()
export class GetCommentThreadQueryHandler implements IQueryHandler<
  GetCommentThreadQuery,
  CommentThreadResult
> {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
  ) {}

  async execute(query: GetCommentThreadQuery): Promise<CommentThreadResult> {
    return this.commentService.getCommentThread(query.commentId);
  }
}
