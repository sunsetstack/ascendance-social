import { Request, Response } from "express";
import { AuthService } from "@/services/auth.service";
import { injectable, inject } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetMeQuery } from "@/application/queries/users/getMe/getMe.query";
import { GetMeResult } from "@/application/queries/users/getMe/getMe.handler";
import { GetAccountInfoQuery } from "@/application/queries/users/getAccountInfo/getAccountInfo.query";
import { GetAccountInfoResult } from "@/application/queries/users/getAccountInfo/getAccountInfo.handler";
import { UpdateAvatarCommand } from "@/application/commands/users/updateAvatar/updateAvatar.command";
import { UpdateCoverCommand } from "@/application/commands/users/updateCover/updateCover.command";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { ChangePasswordCommand } from "@/application/commands/users/changePassword/changePassword.command";
import { TypedRequest } from "@/types";
import type {
  ChangePasswordBody,
  DeleteAccountBody,
  UpdateProfileBody,
} from "@/utils/schemas/user.schemas";
import { TOKENS } from "@/types/tokens";
import { UserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { clearAuthCookies } from "@/controllers/helpers/user-auth-response";
import { PublicUserDTO } from "@/services/dto.service";

type EmptyParams = Record<string, never>;

@injectable()
export class ProfileController {
  constructor(
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  private requireAuthenticatedUserPublicId(req: Request): UserPublicId {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("Authentication required");
    }
    return userPublicId;
  }

  getMe = async (req: Request, res: Response) => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new GetMeQuery(userPublicId);
    const { user } = await this.queryBus.execute<GetMeResult>(query);
    res.status(200).json(user);
  };

  getAccountInfo = async (req: Request, res: Response): Promise<void> => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new GetAccountInfoQuery(userPublicId);
    const result = await this.queryBus.execute<GetAccountInfoResult>(query);
    res.status(200).json(result.accountInfo);
  };

  updateProfile = async (
    req: TypedRequest<EmptyParams, UpdateProfileBody>,
    res: Response,
  ) => {
    const userData = req.body;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const command = new UpdateProfileCommand(userPublicId, userData);
    const updatedUser = await this.commandBus.dispatch<PublicUserDTO>(command);
    res.status(200).json(updatedUser);
  };

  changePassword = async (
    req: TypedRequest<EmptyParams, ChangePasswordBody>,
    res: Response,
  ) => {
    const { currentPassword, newPassword } = req.body;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const command = new ChangePasswordCommand(
      userPublicId,
      currentPassword,
      newPassword,
    );
    await this.commandBus.dispatch(command);
    await this.authService.revokeAllSessionsForUser(userPublicId);
    clearAuthCookies(res);
    res.status(200).json({
      message: "Password changed successfully. Please log in again.",
    });
  };

  updateAvatar = async (req: Request, res: Response) => {
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) throw Errors.validation("No file provided");
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const command = new UpdateAvatarCommand(
      userPublicId,
      fileBuffer,
      req.file?.originalname,
      req.file?.mimetype,
    );
    const updatedUserDTO =
      await this.commandBus.dispatch<PublicUserDTO>(command);
    res.status(200).json(updatedUserDTO);
  };

  updateCover = async (req: Request, res: Response) => {
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) throw Errors.validation("No file provided");
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const command = new UpdateCoverCommand(
      userPublicId,
      fileBuffer,
      req.file?.originalname,
      req.file?.mimetype,
    );
    const updatedUserDTO =
      await this.commandBus.dispatch<PublicUserDTO>(command);
    res.status(200).json(updatedUserDTO);
  };

  deleteMyAccount = async (
    req: TypedRequest<EmptyParams, DeleteAccountBody>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const { password, reason } = req.body;
    const command = new DeleteUserCommand(
      userPublicId,
      password,
      false,
      reason,
    );
    await this.commandBus.dispatch(command);
    clearAuthCookies(res);
    res.status(200).json({ message: "Account deleted successfully" });
  };
}
