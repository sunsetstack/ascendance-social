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
import { ManageConversationCommand, ConversationAction } from "@/application/commands/messaging/manageConversation/manageConversation.command";
import { Errors } from "@/utils/errors";
import { SendMessagePayload, TypedRequest } from "@/types";
import { TOKENS } from "@/types/tokens";
import type {
  ConversationParams,
  EditMessageBody,
  InitiateConversationBody,
  MessageParams,
  PaginationQuery,
  SendMessageBody,
} from "@/utils/schemas/messaging.schemas";
import {
  asConversationPublicId,
  asMessagePublicId,
  asUserPublicId,
} from "@/types/branded";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class MessagingController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  private async manageConversation(
    req: TypedRequest<ConversationParams>, res: Response, action: ConversationAction,
  ): Promise<void> {
    if (!req.decodedUser?.publicId) throw Errors.authentication("User must be logged in");
    await this.commandBus.dispatch(new ManageConversationCommand(
      asUserPublicId(req.decodedUser.publicId),
      asConversationPublicId(req.params.conversationId), action,
    ));
    res.status(204).send();
  }

  deleteConversation = (req: TypedRequest<ConversationParams>, res: Response): Promise<void> =>
    this.manageConversation(req, res, "delete");

  purgeConversation = (req: TypedRequest<ConversationParams>, res: Response): Promise<void> =>
    this.manageConversation(req, res, "purge");

  lockConversation = (req: TypedRequest<ConversationParams>, res: Response): Promise<void> =>
    this.manageConversation(req, res, "lock");

  unlockConversation = (req: TypedRequest<ConversationParams>, res: Response): Promise<void> =>
    this.manageConversation(req, res, "unlock");

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

    const result =
      await this.queryBus.execute(
        new ListConversationsQuery(asUserPublicId(userPublicId), page, limit),
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

    const result = await this.queryBus.execute(
      new GetConversationMessagesQuery(
        asUserPublicId(userPublicId),
        asConversationPublicId(conversationId),
        page,
        limit,
      ),
    );

    res.status(200).json(result);
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
      new MarkConversationReadCommand(
        asUserPublicId(userPublicId),
        asConversationPublicId(conversationId),
      ),
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
      new InitiateConversationCommand(
        asUserPublicId(senderPublicId),
        asUserPublicId(recipientPublicId),
      ),
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

    const payload: SendMessagePayload = {
      ...req.body,
      conversationPublicId: req.body.conversationPublicId
        ? asConversationPublicId(req.body.conversationPublicId)
        : undefined,
      recipientPublicId: req.body.recipientPublicId
        ? asUserPublicId(req.body.recipientPublicId)
        : undefined,
    };

    const message = await this.commandBus.dispatch(
      new SendMessageCommand(asUserPublicId(senderPublicId), payload, req.file),
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
      new EditMessageCommand(
        asUserPublicId(userPublicId),
        asMessagePublicId(messageId),
        body,
      ),
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
      new DeleteMessageCommand(
        asUserPublicId(userPublicId),
        asMessagePublicId(messageId),
      ),
    );
    res.status(204).send();
  };
}
