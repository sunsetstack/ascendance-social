import { Request, Response, NextFunction } from "express";
import { AuthService } from "@/services/auth.service";
import { Errors } from "@/utils/errors";
import { injectable, inject } from "tsyringe";
import {
  accessCookieOptions,
  authCookieNames,
  clearAuthCookieOptions,
  refreshCookieOptions,
} from "@/config/cookieConfig";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
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
  AdminUserDTO,
  AuthenticatedUserDTO,
  HandleSuggestionDTO,
  PublicUserDTO,
} from "@/services/dto.service";
import { UpdateAvatarCommand } from "@/application/commands/users/updateAvatar/updateAvatar.command";
import { UpdateCoverCommand } from "@/application/commands/users/updateCover/updateCover.command";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { FollowUserCommand } from "@/application/commands/users/followUser/followUser.command";
import { FollowUserResult } from "@/application/commands/users/followUser/followUser.handler";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { ChangePasswordCommand } from "@/application/commands/users/changePassword/changePassword.command";
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByUsername/getUserByUsername.query";
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

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

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

  private getRequestContext(req: Request): { ip: string; userAgent: string } {
    const cloudflareIp = req.headers["cf-connecting-ip"];
    const ip =
      typeof cloudflareIp === "string" && cloudflareIp.length > 0
        ? cloudflareIp
        : req.ip || "unknown";
    const userAgent = req.get("User-Agent") || "unknown";
    return { ip, userAgent };
  }

  private toSessionUser(user: AuthenticatedUserDTO | AdminUserDTO): {
    publicId: UserPublicId;
    email: string;
    handle: string;
    username: string;
    isAdmin: boolean;
  } {
    return {
      publicId: user.publicId,
      email: user.email,
      handle: user.handle,
      username: user.username,
      isAdmin: "isAdmin" in user ? Boolean(user.isAdmin) : false,
    };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    res.cookie(authCookieNames.accessToken, accessToken, accessCookieOptions);
    res.cookie(
      authCookieNames.refreshToken,
      refreshToken,
      refreshCookieOptions,
    );
    // cleanup legacy cookie used by previous auth flow
    res.clearCookie(authCookieNames.legacyToken, clearAuthCookieOptions);
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(authCookieNames.accessToken, clearAuthCookieOptions);
    res.clearCookie(authCookieNames.refreshToken, clearAuthCookieOptions);
    res.clearCookie(authCookieNames.legacyToken, clearAuthCookieOptions);
  }

  private requireAuthenticatedUserPublicId(req: Request): UserPublicId {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("Authentication required");
    }
    return userPublicId;
  }

  register = async (
    req: TypedRequest<EmptyParams, RegistrationBody>,
    res: Response,
  ) => {
    const { handle, username, email, password } = req.body;
    const { ip, userAgent } = this.getRequestContext(req);
    const command = new RegisterUserCommand(
      handle,
      username,
      email,
      password,
      undefined,
      undefined,
      ip,
    );
    const { user } =
      await this.commandBus.dispatch<RegisterUserResult>(command);
    const { accessToken, refreshToken } =
      await this.authService.issueTokensForUser(this.toSessionUser(user), {
        ip,
        userAgent,
      });
    this.setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user });
  };

  // Refresh
  getMe = async (req: Request, res: Response, next: NextFunction) => {
    const { decodedUser } = req;
    if (!decodedUser?.publicId) {
      return next(Errors.authentication("User not authenticated."));
    }
    const query = new GetMeQuery(decodedUser.publicId);
    const { user } = await this.queryBus.execute<GetMeResult>(query);
    res.status(200).json(user);
  };

  login = async (req: TypedRequest<EmptyParams, LoginBody>, res: Response) => {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await this.authService.login(
      email,
      password,
      this.getRequestContext(req),
    );
    this.setAuthCookies(res, accessToken, refreshToken);
    res.status(200).json({ user });
  };

  refresh = async (req: Request, res: Response, next: NextFunction) => {
    const refreshToken = req.cookies?.[authCookieNames.refreshToken];
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return next(Errors.authentication("Refresh token missing"));
    }

    const {
      user,
      accessToken,
      refreshToken: nextRefreshToken,
    } = await this.authService.refreshSession(
      refreshToken,
      this.getRequestContext(req),
    );
    this.setAuthCookies(res, accessToken, nextRefreshToken);
    res.status(200).json({ user });
  };

  logout = async (req: Request, res: Response) => {
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

    if (revocationTasks.length > 0) {
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

    this.clearAuthCookies(res);
    res.status(200).json({ message: "Logged out successfully" });
  };

  updateProfile = async (
    req: TypedRequest<EmptyParams, UpdateProfileBody>,
    res: Response,
  ) => {
    const { decodedUser } = req;
    const userData = req.body;
    if (!decodedUser) {
      throw Errors.authentication("User not authenticated.");
    }
    if (!decodedUser.publicId)
      throw Errors.authentication("User not authenticated.");

    const command = new UpdateProfileCommand(decodedUser.publicId, userData);
    const updatedUser = await this.commandBus.dispatch<PublicUserDTO>(command);
    res.status(200).json(updatedUser);
  };

  changePassword = async (
    req: TypedRequest<EmptyParams, ChangePasswordBody>,
    res: Response,
  ) => {
    const { decodedUser } = req;
    const { currentPassword, newPassword } = req.body; // already validated by Zod middleware

    if (!decodedUser) {
      throw Errors.authentication("User not authenticated.");
    }
    if (!decodedUser.publicId)
      throw Errors.authentication("User not authenticated.");

    const command = new ChangePasswordCommand(
      decodedUser.publicId,
      currentPassword,
      newPassword,
    );
    await this.commandBus.dispatch(command);
    await this.authService.revokeAllSessionsForUser(decodedUser.publicId);
    this.clearAuthCookies(res);

    res.status(200).json({
      message: "Password changed successfully. Please log in again.",
    });
  };

  updateAvatar = async (req: Request, res: Response, next: NextFunction) => {
    const { decodedUser } = req;
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) throw Errors.validation("No file provided");
    if (!decodedUser) {
      throw Errors.authentication("User not authenticated.");
    }
    if (!decodedUser.publicId)
      throw Errors.authentication("User not authenticated.");

    const command = new UpdateAvatarCommand(
      decodedUser.publicId,
      fileBuffer,
      req.file?.originalname,
      req.file?.mimetype,
    );
    const updatedUserDTO =
      await this.commandBus.dispatch<PublicUserDTO>(command);

    res.status(200).json(updatedUserDTO);
  };

  updateCover = async (req: Request, res: Response, next: NextFunction) => {
    const { decodedUser } = req;
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) throw Errors.validation("No file provided");
    if (!decodedUser) {
      throw Errors.authentication("User not authenticated.");
    }
    if (!decodedUser.publicId)
      throw Errors.authentication("User not authenticated.");

    const command = new UpdateCoverCommand(
      decodedUser.publicId,
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
    const followerPublicId = this.requireAuthenticatedUserPublicId(req);

    const command = new FollowUserCommand(
      followerPublicId,
      asUserPublicId(publicId),
    );
    const result = await this.commandBus.dispatch<FollowUserResult>(command);
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
    const followerPublicId = this.requireAuthenticatedUserPublicId(req);

    const command = new FollowUserCommand(
      followerPublicId,
      asUserPublicId(publicId),
    );
    const result = await this.commandBus.dispatch<FollowUserResult>(command);
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

    this.clearAuthCookies(res);
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

    logger.info(
      `[LIKEACTION]: User public ID: ${userPublicId}, Post public ID: ${publicId}`,
    );
    logger.info(publicId);
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
    next: NextFunction,
  ) => {
    const { decodedUser } = req;
    if (!decodedUser?.publicId) {
      return next(Errors.authentication("User not authenticated."));
    }

    const { limit } = req.query;

    const query = new GetWhoToFollowQuery(decodedUser.publicId, limit);
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
