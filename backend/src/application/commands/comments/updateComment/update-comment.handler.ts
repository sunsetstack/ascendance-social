import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { UpdateCommentCommand } from "./updateComment.command";
import { CommentService } from "@/services/comment.service";
import { TransformedComment } from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UpdateCommentCommandHandler implements ICommandHandler<
  UpdateCommentCommand,
  TransformedComment
> {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
  ) {}

  async execute(command: UpdateCommentCommand): Promise<TransformedComment> {
    return this.commentService.updateCommentByPublicId(
      command.commentId,
      command.userPublicId,
      command.content,
    );
  }
}
