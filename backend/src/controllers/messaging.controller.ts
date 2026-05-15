import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { ListConversationsQuery } from "@/application/queries/messaging/listConversations/listConversations.query";
import { GetConversationMessagesQuery } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.query";
import { InitiateConversationCommand } from "@/application/commands/messaging/initiateConversation/initiateConversation.command";
import { SendMessageCommand } from "@/application/commands/messaging/sendMessage/sendMessage.command";
import { MarkConversationReadCommand } from "@/application/commands/messaging/markConversationRead/markConversationRead.command";
import { EditMessageCommand } from "@/application/commands/messaging/editMessage/editMessage.command";
import { DeleteMessageCommand } from "@/application/commands/messaging/deleteMessage/deleteMessage.command";
import { Errors } from "@/utils/errors";
import { SendMessagePayload, TypedRequest } from "@/types";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import { TOKENS } from "@/types/tokens";
import type {
  ConversationParams,
  EditMessageBody,
  InitiateConversationBody,
  MessageParams,
  PaginationQuery,
  SendMessageBody,
} from "@/utils/schemas/messaging.schemas";
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class MessagingController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  listConversations = async (
    req: TypedRequest<EmptyParams, EmptyBody, PaginationQuery>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication(
        "User must be logged in to view conversations",
      );
    }

    const { page, limit } = req.query;

    const result = await this.queryBus.execute<any>(
      new ListConversationsQuery(userPublicId, page, limit)
    );
    res.status(200).json(result);
  };

  getConversationMessages = async (
    req: TypedRequest<ConversationParams, EmptyBody, PaginationQuery>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("User must be logged in to view messages");
    }

    const { conversationId } = req.params;
    const { page, limit } = req.query;

    const result = await this.queryBus.execute<any>(
      new GetConversationMessagesQuery(userPublicId, conversationId, page, limit)
    );

    if (result.messages.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.messages,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "messages" },
      );
    } else {
      res.status(200).json(result);
    }
  };

  markConversationRead = async (
    req: TypedRequest<ConversationParams>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication(
        "User must be logged in to update read state",
      );
    }

    const { conversationId } = req.params;
    await this.commandBus.dispatch(
      new MarkConversationReadCommand(userPublicId, conversationId)
    );
    res.status(204).send();
  };

  initiateConversation = async (
    req: TypedRequest<EmptyParams, InitiateConversationBody>,
    res: Response,
  ): Promise<void> => {
    const senderPublicId = req.decodedUser?.publicId;
    if (!senderPublicId) {
      throw Errors.authentication(
        "User must be logged in to start a conversation",
      );
    }

    const { recipientPublicId } = req.body;

    const conversation = await this.commandBus.dispatch(
      new InitiateConversationCommand(senderPublicId, recipientPublicId)
    );
    res.status(201).json({ conversation });
  };

  sendMessage = async (
    req: TypedRequest<EmptyParams, SendMessageBody>,
    res: Response,
  ): Promise<void> => {
    const senderPublicId = req.decodedUser?.publicId;
    if (!senderPublicId) {
      throw Errors.authentication("User must be logged in to send messages");
    }

    const payload: SendMessagePayload = req.body;

    const message = await this.commandBus.dispatch(
      new SendMessageCommand(senderPublicId, payload, req.file)
    );
    res.status(201).json({ message });
  };

  editMessage = async (
    req: TypedRequest<MessageParams, EditMessageBody>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("User must be logged in to edit messages");
    }

    const { messageId } = req.params;
    const { body } = req.body;

    const message = await this.commandBus.dispatch(
      new EditMessageCommand(userPublicId, messageId, body)
    );
    res.status(200).json({ message });
  };

  deleteMessage = async (
    req: TypedRequest<MessageParams>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("User must be logged in to delete messages");
    }

    const { messageId } = req.params;

    await this.commandBus.dispatch(
      new DeleteMessageCommand(userPublicId, messageId)
    );
    res.status(204).send();
  };
}
