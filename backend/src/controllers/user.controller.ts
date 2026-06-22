import { Request, Response } from "express";
import { AuthService } from "@/services/auth.service";
import { Errors } from "@/utils/errors";
import { injectable, inject } from "tsyringe";
import { authCookieNames } from "@/config/cookieConfig";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { LoginCommand } from "@/application/commands/auth/login/login.command";
import { RefreshSessionCommand } from "@/application/commands/auth/refreshSession/refreshSession.command";
import { RegisterUserCommand } from "@/application/commands/users/register/register.command";
import { RegisterUserResult } from "@/application/commands/users/register/register.handler";
import { GetMeQuery } from "@/application/queries/users/getMe/getMe.query";
import { GetMeResult } from "@/application/queries/users/getMe/getMe.handler";
import { GetAccountInfoQuery } from "@/application/queries/users/getAccountInfo/getAccountInfo.query";
import { GetAccountInfoResult } from "@/application/queries/users/getAccountInfo/getAccountInfo.handler";
import { LikeActionByPublicIdCommand } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.command";
import { GetWhoToFollowQuery } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.query";
import { GetWhoToFollowResult } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.handler";
import { GetHandleSuggestionsQuery } from "@/application/queries/users/getHandleSuggestions/getHandleSuggestions.query";
import {
  HandleSuggestionDTO,
  PublicUserDTO,
} from "@/services/dto.service";
import { UpdateAvatarCommand } from "@/application/commands/users/updateAvatar/updateAvatar.command";
import { UpdateCoverCommand } from "@/application/commands/users/updateCover/updateCover.command";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { SetFollowStateCommand } from "@/application/commands/users/setFollowState/setFollowState.command";
import { SetFollowStateResult } from "@/application/commands/users/setFollowState/setFollowState.handler";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { ChangePasswordCommand } from "@/application/commands/users/changePassword/changePassword.command";
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByHandle/getUserByHandle.query";
import { GetUserByPublicIdQuery } from "@/application/queries/users/getUserByPublicId/getUserByPublicId.query";
import { GetUsersQuery } from "@/application/queries/users/getUsers/getUsers.query";
import { CheckFollowStatusQuery } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.query";
import { GetFollowersQuery } from "@/application/queries/users/getFollowers/getFollowers.query";
import { GetFollowersResult } from "@/application/queries/users/getFollowers/getFollowers.handler";
import { GetFollowingQuery } from "@/application/queries/users/getFollowing/getFollowing.query";
import { GetFollowingResult } from "@/application/queries/users/getFollowing/getFollowing.handler";
import { RequestPasswordResetCommand } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetCommand";
import { ResetPasswordCommand } from "@/application/commands/users/resetPassword/ResetPasswordCommand";
import { VerifyEmailCommand } from "@/application/commands/users/verifyEmail/VerifyEmailCommand";
import { TypedRequest } from "@/types";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import type {
  ChangePasswordBody,
  DeleteAccountBody,
  HandleParams,
  HandleSuggestionsQuery as HandleSuggestionsQueryParams,
  LoginBody,
  PublicIdParams as UserPublicIdParams,
  PublicUserListQuery,
  RegistrationBody,
  RequestPasswordResetBody,
  ResetPasswordBody,
  UpdateProfileBody,
  UsersQuery,
  VerifyEmailBody,
  WhoToFollowQuery,
} from "@/utils/schemas/user.schemas";

import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId, asPostPublicId, UserPublicId } from "@/types/branded";
import {
  buildAuthRequestContext,
  clearAuthCookies,
  setAuthCookies,
  toSessionUser,
} from "@/controllers/helpers/user-auth-response";

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";
import { AuthenticatedSessionResult } from "@/services/auth.service";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

/**
 * When using Dependency Injection in Express, there's a common
 * issue with route handles and `this` binding. When Express calls the route handlers,
 * it changes the context of `this` since the method is passed as a callback. So when I initialize the dependncy inside the constructor
 * like this.userService = userService, `this` context is lost and this.userService is undefined.
 *
 * 2 possible fixes:
 *  1 - manually bind all methods that will be used as route handlers:
 *     - this.register = this.register.bind(this);
 *     - etc etc, for every single method
 *  2 - user arrow functions, which automatically bind `this` and it doesn't get lost because they don't have their own 'this' context but use global one
 *     - this is the approach I used here
 */

@injectable()
export class UserController {
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

  private requireRefreshToken(req: Request): string {
    const refreshToken = req.cookies?.[authCookieNames.refreshToken];
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw Errors.authentication("Refresh token missing");
    }
    return refreshToken;
  }

  private async revokeSessionFromRequest(req: Request): Promise<void> {
    const refreshToken = req.cookies?.[authCookieNames.refreshToken];
    const accessToken =
      req.cookies?.[authCookieNames.accessToken] ||
      req.cookies?.[authCookieNames.legacyToken];
    const revocationTasks: Promise<void>[] = [];

    if (typeof refreshToken === "string" && refreshToken.length > 0) {
      revocationTasks.push(
        this.authService.revokeSessionByRefreshToken(refreshToken),
      );
    } else if (typeof accessToken === "string" && accessToken.length > 0) {
      revocationTasks.push(
        this.authService.revokeSessionByAccessToken(accessToken),
      );
    }

    if (revocationTasks.length === 0) {
      return;
    }

    const revocationResults = await Promise.allSettled(revocationTasks);
    for (const result of revocationResults) {
      if (result.status === "rejected") {
        const reasonMessage =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        logger.warn(`[AUTH] Logout revocation failed: ${reasonMessage}`);
      }
    }
  }

  register = async (
    req: TypedRequest<EmptyParams, RegistrationBody>,
    res: Response,
  ) => {
    const { handle, username, email, password } = req.body;
    const requestContext = buildAuthRequestContext(req);
    const command = new RegisterUserCommand(
      handle,
      username,
      email,
      password,
      undefined,
      undefined,
      requestContext.ip,
    );
    const { user } =
      await this.commandBus.dispatch<RegisterUserResult>(command);
    const { accessToken, refreshToken } =
      await this.authService.issueTokensForUser(
        toSessionUser(user),
        requestContext,
      );
    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user });
  };

  getMe = async (req: Request, res: Response) => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new GetMeQuery(userPublicId);
    const { user } = await this.queryBus.execute<GetMeResult>(query);
    res.status(200).json(user);
  };

  login = async (req: TypedRequest<EmptyParams, LoginBody>, res: Response) => {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } =
      await this.commandBus.dispatch<AuthenticatedSessionResult>(
        new LoginCommand(email, password, buildAuthRequestContext(req)),
      );
    setAuthCookies(res, accessToken, refreshToken);
    res.status(200).json({ user });
  };

  refresh = async (req: Request, res: Response) => {
    const refreshToken = this.requireRefreshToken(req);
    const {
      user,
      accessToken,
      refreshToken: nextRefreshToken,
    } = await this.commandBus.dispatch<AuthenticatedSessionResult>(
      new RefreshSessionCommand(refreshToken, buildAuthRequestContext(req)),
    );
    setAuthCookies(res, accessToken, nextRefreshToken);
    res.status(200).json({ user });
  };

  logout = async (req: Request, res: Response) => {
    await this.revokeSessionFromRequest(req);
    clearAuthCookies(res);
    res.status(200).json({ message: "Logged out successfully" });
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
    const { currentPassword, newPassword } = req.body; // already validated by Zod middleware
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

  /**
   * Follow a user by their public ID
   */
  followUserByPublicId = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const result = await this.commandBus.dispatch<SetFollowStateResult>(
      new SetFollowStateCommand(
        this.requireAuthenticatedUserPublicId(req),
        asUserPublicId(publicId),
        true,
      ),
    );
    res.status(200).json(result);
  };

  /**
   * Unfollow a user by their public ID
   */
  unfollowUserByPublicId = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const result = await this.commandBus.dispatch<SetFollowStateResult>(
      new SetFollowStateCommand(
        this.requireAuthenticatedUserPublicId(req),
        asUserPublicId(publicId),
        false,
      ),
    );
    res.status(200).json(result);
  };

  /**
   * Check if current user follows another user
   */
  checkFollowStatus = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const followerPublicId = this.requireAuthenticatedUserPublicId(req);

    const query = new CheckFollowStatusQuery(
      followerPublicId,
      asUserPublicId(publicId),
    );
    const isFollowing = await this.queryBus.execute<boolean>(query);
    res.status(200).json({ isFollowing });
  };

  getFollowers = async (
    req: TypedRequest<UserPublicIdParams, EmptyBody, PublicUserListQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit } = req.query;

    const query = new GetFollowersQuery(asUserPublicId(publicId), page, limit);
    const result = await this.queryBus.execute<GetFollowersResult>(query);

    if (result.users.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.users,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "users" },
      );
    } else {
      res.status(200).json(result);
    }
  };

  getFollowing = async (
    req: TypedRequest<UserPublicIdParams, EmptyBody, PublicUserListQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit } = req.query;

    const query = new GetFollowingQuery(asUserPublicId(publicId), page, limit);
    const result = await this.queryBus.execute<GetFollowingResult>(query);

    if (result.users.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.users,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "users" },
      );
    } else {
      res.status(200).json(result);
    }
  };

  getAccountInfo = async (req: Request, res: Response): Promise<void> => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);

    const query = new GetAccountInfoQuery(userPublicId);
    const result = await this.queryBus.execute<GetAccountInfoResult>(query);
    res.status(200).json(result.accountInfo);
  };

  deleteMyAccount = async (
    req: TypedRequest<EmptyParams, DeleteAccountBody>,
    res: Response,
  ): Promise<void> => {
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const { password } = req.body;

    const command = new DeleteUserCommand(userPublicId, password);
    await this.commandBus.dispatch(command);
    await this.authService.revokeAllSessionsForUser(userPublicId);

    clearAuthCookies(res);
    res.status(200).json({ message: "Account deleted successfully" });
  };

  requestPasswordReset = async (
    req: TypedRequest<EmptyParams, RequestPasswordResetBody>,
    res: Response,
  ) => {
    const { email } = req.body;
    const command = new RequestPasswordResetCommand(email);
    await this.commandBus.dispatch(command);
    res.status(200).json({
      message:
        "If an account with that email exists, a password reset link has been sent.",
    });
  };

  resetPassword = async (
    req: TypedRequest<EmptyParams, ResetPasswordBody>,
    res: Response,
  ) => {
    const { token, newPassword } = req.body;
    const command = new ResetPasswordCommand(token, newPassword);
    await this.commandBus.dispatch(command);
    res.status(200).json({ message: "Password reset successful" });
  };

  verifyEmail = async (
    req: TypedRequest<EmptyParams, VerifyEmailBody>,
    res: Response,
  ) => {
    const { email, token } = req.body;
    const command = new VerifyEmailCommand(email, token);
    const user = await this.commandBus.dispatch(command);
    res.status(200).json(user);
  };

  getUsers = async (
    req: TypedRequest<EmptyParams, EmptyBody, UsersQuery>,
    res: Response,
  ) => {
    const query = new GetUsersQuery(req.query);
    const result = await this.queryBus.execute(query);
    res.status(200).json(result);
  };

  likeActionByPublicId = async (req: Request, res: Response) => {
    let { publicId } = req.params;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);

    // strip file extension for backward compatibility
    publicId = publicId.replace(/\.[a-z0-9]{2,5}$/i, "");

    const command = new LikeActionByPublicIdCommand(
      userPublicId,
      asPostPublicId(publicId),
    );
    const result = await this.commandBus.dispatch(command);
    res.status(200).json(result);
  };

  getWhoToFollow = async (
    req: TypedRequest<EmptyParams, EmptyBody, WhoToFollowQuery>,
    res: Response,
  ) => {
    const { limit } = req.query;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new GetWhoToFollowQuery(userPublicId, limit);
    const result = await this.queryBus.execute<GetWhoToFollowResult>(query);

    res.status(200).json(result);
  };

  getHandleSuggestions = async (
    req: TypedRequest<EmptyParams, EmptyBody, HandleSuggestionsQueryParams>,
    res: Response,
  ) => {
    const { q: queryValue, context, limit } = req.query;
    const viewerPublicId = req.decodedUser?.publicId;

    const query = new GetHandleSuggestionsQuery(
      queryValue,
      context,
      limit,
      viewerPublicId,
    );
    const result = await this.queryBus.execute<HandleSuggestionDTO[]>(query);

    res.status(200).json({ users: result });
  };
}
