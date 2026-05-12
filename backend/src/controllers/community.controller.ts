import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { CreateCommunityCommand } from "@/application/commands/community/createCommunity/createCommunity.command";
import { JoinCommunityCommand } from "@/application/commands/community/joinCommunity/joinCommunity.command";
import { LeaveCommunityCommand } from "@/application/commands/community/leaveCommunity/leaveCommunity.command";
import { GetCommunityDetailsQuery } from "@/application/queries/community/getCommunityDetails/getCommunityDetails.query";
import { GetUserCommunitiesQuery } from "@/application/queries/community/getUserCommunities/getUserCommunities.query";
import { GetCommunityFeedQuery } from "@/application/queries/community/getCommunityFeed/getCommunityFeed.query";
import { GetAllCommunitiesQuery } from "@/application/queries/community/getAllCommunities/getAllCommunities.query";
import { GetCommunityMembersQuery } from "@/application/queries/community/getCommunityMembers/getCommunityMembers.query";
import { UpdateCommunityCommand } from "@/application/commands/community/updateCommunity/updateCommunity.command";
import { DeleteCommunityCommand } from "@/application/commands/community/deleteCommunity/deleteCommunity.command";
import { KickMemberCommand } from "@/application/commands/community/kickMember/kickMember.command";
import { Errors } from "@/utils/errors";
import { ICommunity, TypedRequest } from "@/types";
import { DTOService } from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";
import type {
  CommunityPaginationQuery,
  CommunityPublicIdParams,
  CommunitySearchQuery,
  CommunitySlugParams,
  CreateCommunityBody,
  KickMemberParams,
  UpdateCommunityBody,
} from "@/utils/schemas/community.schemas";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class CommunityController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  getAllCommunities = async (
    req: TypedRequest<EmptyParams, EmptyBody, CommunitySearchQuery>,
    res: Response,
  ): Promise<void> => {
    const { page, limit, search } = req.query;
    const viewerPublicId = req.decodedUser?.publicId;

    const query = new GetAllCommunitiesQuery(
      page,
      limit,
      search,
      viewerPublicId,
    );
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };

  createCommunity = async (
    req: TypedRequest<EmptyParams, CreateCommunityBody>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { name, description } = req.body;
    const avatarBuffer = req.file?.buffer;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const command = new CreateCommunityCommand(
      name,
      description,
      decodedUser.publicId,
      avatarBuffer,
      req.file?.originalname,
      req.file?.mimetype,
    );
    const community = await this.commandBus.dispatch<ICommunity>(command);
    res.status(201).json(
      this.dtoService.toCommunityDTO(community, {
        isMember: true,
        isCreator: true,
        isAdmin: true,
      }),
    );
  };

  joinCommunity = async (
    req: TypedRequest<CommunityPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { id } = req.params;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const command = new JoinCommunityCommand(id, decodedUser.publicId);
    await this.commandBus.dispatch(command);
    res.status(200).json({ message: "Joined community successfully" });
  };

  leaveCommunity = async (
    req: TypedRequest<CommunityPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { id } = req.params;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const command = new LeaveCommunityCommand(id, decodedUser.publicId);
    await this.commandBus.dispatch(command);
    res.status(200).json({ message: "Left community successfully" });
  };

  getCommunityDetails = async (
    req: TypedRequest<CommunitySlugParams>,
    res: Response,
  ): Promise<void> => {
    const { slug } = req.params;
    const viewerPublicId = req.decodedUser?.publicId;
    const query = new GetCommunityDetailsQuery(slug, viewerPublicId);
    const community = await this.queryBus.execute(query);
    res.status(200).json(community);
  };

  getUserCommunities = async (
    req: TypedRequest<EmptyParams, EmptyBody, CommunityPaginationQuery>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { page, limit } = req.query;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const query = new GetUserCommunitiesQuery(
      decodedUser.publicId,
      page,
      limit,
    );
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };

  getCommunityFeed = async (
    req: TypedRequest<
      CommunityPublicIdParams,
      EmptyBody,
      CommunityPaginationQuery
    >,
    res: Response,
  ): Promise<void> => {
    const { id } = req.params;
    const { page, limit } = req.query;

    const query = new GetCommunityFeedQuery(id, page, limit);
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };

  updateCommunity = async (
    req: TypedRequest<CommunityPublicIdParams, UpdateCommunityBody>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { id } = req.params;
    const { name, description } = req.body ?? {};

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    // handle file uploads - req.files comes from multer fields middleware
    const files =
      req.files && !Array.isArray(req.files) ? req.files : undefined;
    const avatarBuffer = files?.avatar?.[0]?.buffer;
    const coverPhotoBuffer = files?.coverPhoto?.[0]?.buffer;

    const updates = {
      name: name ?? undefined,
      description: description ?? undefined,
      avatarBuffer,
      avatarOriginalName: files?.avatar?.[0]?.originalname,
      avatarMimeType: files?.avatar?.[0]?.mimetype,
      coverPhotoBuffer,
      coverPhotoOriginalName: files?.coverPhoto?.[0]?.originalname,
      coverPhotoMimeType: files?.coverPhoto?.[0]?.mimetype,
    };

    const command = new UpdateCommunityCommand(
      id,
      decodedUser.publicId,
      updates,
    );
    const community = await this.commandBus.dispatch<ICommunity>(command);
    res.status(200).json(this.dtoService.toCommunityDTO(community));
  };

  deleteCommunity = async (
    req: TypedRequest<CommunityPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { id } = req.params;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const command = new DeleteCommunityCommand(id, decodedUser.publicId);
    await this.commandBus.dispatch(command);
    res.status(204).send();
  };

  getCommunityMembers = async (
    req: TypedRequest<CommunitySlugParams, EmptyBody, CommunityPaginationQuery>,
    res: Response,
  ): Promise<void> => {
    const { slug } = req.params;
    const { page, limit } = req.query;

    const query = new GetCommunityMembersQuery(slug, page, limit);
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };

  kickMember = async (
    req: TypedRequest<KickMemberParams>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser } = req;
    const { id, userId } = req.params;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const command = new KickMemberCommand(id, decodedUser.publicId, userId);
    await this.commandBus.dispatch(command);
    res.status(200).json({ message: "Member kicked successfully" });
  };
}
