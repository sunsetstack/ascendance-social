import { Response } from "express";
import { injectable, inject } from "tsyringe";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByHandle/getUserByHandle.query";
import { GetUserByPublicIdQuery } from "@/application/queries/users/getUserByPublicId/getUserByPublicId.query";
import { GetUsersQuery } from "@/application/queries/users/getUsers/getUsers.query";
import { TypedRequest } from "@/types";
import type {
  HandleParams,
  PublicIdParams as UserPublicIdParams,
  UsersQuery,
} from "@/utils/schemas/user.schemas";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";
import { PublicUserDTO } from "@/services/dto.service";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class UserQueryController {
  constructor(
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  getUserByHandle = async (
    req: TypedRequest<HandleParams>,
    res: Response,
  ): Promise<void> => {
    const { handle } = req.params;
    const query = new GetUserByHandleQuery(handle);
    const userDTO = await this.queryBus.execute<PublicUserDTO>(query);
    res.status(200).json(userDTO);
  };

  getUserByPublicId = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const query = new GetUserByPublicIdQuery(asUserPublicId(publicId));
    const userDTO = await this.queryBus.execute<PublicUserDTO>(query);
    res.status(200).json(userDTO);
  };

  getUsers = async (
    req: TypedRequest<EmptyParams, EmptyBody, UsersQuery>,
    res: Response,
  ) => {
    const query = new GetUsersQuery(req.query);
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };
}
