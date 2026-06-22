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
}
