import { Request, Response } from "express";
import { AuthService } from "@/services/auth.service";
import { injectable, inject } from "tsyringe";
import { authCookieNames } from "@/config/cookieConfig";
import { CommandBus } from "@/application/common/buses/command.bus";
import { LoginCommand } from "@/application/commands/auth/login/login.command";
import { RefreshSessionCommand } from "@/application/commands/auth/refreshSession/refreshSession.command";
import { RegisterUserCommand } from "@/application/commands/users/register/register.command";
import { RegisterUserResult } from "@/application/commands/users/register/register.handler";
import { RequestPasswordResetCommand } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetCommand";
import { ResetPasswordCommand } from "@/application/commands/users/resetPassword/ResetPasswordCommand";
import { VerifyEmailCommand } from "@/application/commands/users/verifyEmail/VerifyEmailCommand";
import { VerifyEmailResult } from "@/application/commands/users/verifyEmail/VerifyEmailHandler";
import { TypedRequest } from "@/types";
import type {
  LoginBody,
  RegistrationBody,
  RequestPasswordResetBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "@/utils/schemas/user.schemas";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import {
  buildAuthRequestContext,
  clearAuthCookies,
  setAuthCookies,
  toSessionUser,
} from "@/controllers/helpers/user-auth-response";
import { Errors } from "@/utils/errors";
import { AuthenticatedSessionResult } from "@/services/auth.service";

type EmptyParams = Record<string, never>;

@injectable()
export class AuthController {
  constructor(
    @inject(TOKENS.Services.Auth) private readonly authService: AuthService,
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
  ) {}

  private requireRefreshToken(req: Request): string {
    const refreshToken = req.cookies?.[authCookieNames.refreshToken];
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw Errors.authentication("Refresh token missing");
    }
    return refreshToken;
  }

  private getRefreshSessionId(req: Request): string | undefined {
    const refreshToken = req.cookies?.[authCookieNames.refreshToken];
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return undefined;
    }

    return this.authService.extractSessionIdFromRefreshToken(refreshToken);
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

    if (revocationTasks.length === 0) return;

    const results = await Promise.allSettled(revocationTasks);
    for (const result of results) {
      if (result.status === "rejected") {
        const msg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        logger.warn(`[AUTH] Logout revocation failed: ${msg}`);
      }
    }
  }

  register = async (
    req: TypedRequest<EmptyParams, RegistrationBody>,
    res: Response,
  ) => {
    const { handle, username, email, password } = req.body;
    const requestContext = buildAuthRequestContext(req);
    req.authLogMetadata = {
      authAction: "register",
      authSource: "credentials",
      authState: "auth_failed",
      authEmail: email,
      authUsername: username,
      authHandle: handle,
      refreshRotated: false,
    };
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
    const { accessToken, refreshToken, sid } =
      await this.authService.issueTokensForUser(
        toSessionUser(user),
        requestContext,
      );
    req.authLogMetadata = {
      authAction: "register",
      userId: user.publicId,
      authEmail: user.email,
      authUsername: user.username,
      authHandle: user.handle,
      sessionId: sid,
      tokenFamilyId: sid,
      authSource: "credentials",
      authState: "authenticated",
      refreshRotated: false,
    };
    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user });
  };

  login = async (req: TypedRequest<EmptyParams, LoginBody>, res: Response) => {
    const { email, password } = req.body;
    req.authLogMetadata = {
      authAction: "login",
      authSource: "credentials",
      authState: "auth_failed",
      authEmail: email,
      refreshRotated: false,
    };
    const { user, accessToken, refreshToken, sid } =
      await this.commandBus.dispatch<AuthenticatedSessionResult>(
        new LoginCommand(email, password, buildAuthRequestContext(req)),
      );
    req.authLogMetadata = {
      authAction: "login",
      userId: user.publicId,
      authEmail: user.email,
      authUsername: user.username,
      authHandle: user.handle,
      sessionId: sid,
      tokenFamilyId: sid,
      authSource: "credentials",
      authState: "authenticated",
      refreshRotated: false,
    };
    setAuthCookies(res, accessToken, refreshToken);
    res.status(200).json({ user });
  };

  refresh = async (req: Request, res: Response) => {
    const refreshSessionId = this.getRefreshSessionId(req);
    req.authLogMetadata = {
      authAction: "refresh",
      authSource: "refresh_token",
      authState: "auth_failed",
      sessionId: refreshSessionId,
      tokenFamilyId: refreshSessionId,
      refreshRotated: false,
    };
    const refreshToken = this.requireRefreshToken(req);
    const {
      user,
      accessToken,
      refreshToken: nextRefreshToken,
      sid,
    } = await this.commandBus.dispatch<AuthenticatedSessionResult>(
      new RefreshSessionCommand(refreshToken, buildAuthRequestContext(req)),
    );
    req.authLogMetadata = {
      authAction: "refresh",
      userId: user.publicId,
      authEmail: user.email,
      authUsername: user.username,
      authHandle: user.handle,
      sessionId: sid,
      tokenFamilyId: sid,
      authSource: "refresh_token",
      authState: "authenticated",
      refreshRotated: true,
    };
    setAuthCookies(res, accessToken, nextRefreshToken);
    res.status(200).json({ user });
  };

  logout = async (req: Request, res: Response) => {
    const refreshSessionId = this.getRefreshSessionId(req);
    const hasSessionContext = Boolean(req.decodedUser?.sid ?? refreshSessionId);
    req.authLogMetadata = {
      authAction: "logout",
      userId: req.decodedUser?.publicId,
      authEmail: req.decodedUser?.email,
      authUsername: req.decodedUser?.username,
      authHandle: req.decodedUser?.handle,
      sessionId: req.decodedUser?.sid ?? refreshSessionId,
      tokenFamilyId: req.decodedUser?.sid ?? refreshSessionId,
      authSource: refreshSessionId
        ? "refresh_token"
        : req.decodedUser
          ? "access_token"
          : "none",
      authState: hasSessionContext ? "authenticated" : "anonymous",
      refreshRotated: false,
    };
    await this.revokeSessionFromRequest(req);
    clearAuthCookies(res);
    res.status(200).json({ message: "Logged out successfully" });
  };

  requestPasswordReset = async (
    req: TypedRequest<EmptyParams, RequestPasswordResetBody>,
    res: Response,
  ) => {
    const { email } = req.body;
    req.authLogMetadata = {
      authAction: "password_reset_requested",
      authSource: "credentials",
      authState: "anonymous",
      authEmail: email,
      refreshRotated: false,
    };
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
    req.authLogMetadata = {
      authAction: "password_reset",
      authSource: "reset_token",
      authState: "auth_failed",
      refreshRotated: false,
    };
    const command = new ResetPasswordCommand(token, newPassword);
    await this.commandBus.dispatch(command);
    req.authLogMetadata = {
      ...req.authLogMetadata,
      authState: "token_valid",
    };
    res.status(200).json({ message: "Password reset successful" });
  };

  verifyEmail = async (
    req: TypedRequest<EmptyParams, VerifyEmailBody>,
    res: Response,
  ) => {
    const { email, token } = req.body;
    req.authLogMetadata = {
      authAction: "email_verify",
      authSource: "email_token",
      authState: "auth_failed",
      authEmail: email,
      refreshRotated: false,
    };
    const command = new VerifyEmailCommand(email, token);
    const user = await this.commandBus.dispatch<VerifyEmailResult>(command);
    req.authLogMetadata = {
      authAction: "email_verify",
      userId: user.publicId,
      authEmail: user.email,
      authUsername: user.username,
      authHandle: user.handle,
      authSource: "email_token",
      authState: "authenticated",
      refreshRotated: false,
    };
    res.status(200).json(user);
  };
}
