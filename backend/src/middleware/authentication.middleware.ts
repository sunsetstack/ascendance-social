import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import {
  Errors,
  ErrorCode,
  isErrorWithStatusCode,
  getErrorMessage,
  getErrorName,
} from "@/utils/errors";
import { DecodedUser, AdminContext } from "@/types";
import { asUserPublicId, asSessionId } from "@/types/branded";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { logger } from "@/utils/winston";
import { authCookieNames } from "@/config/cookieConfig";
import { AuthSessionService } from "@/services/auth-session.service";
import { MetricsService } from "@/metrics/metrics.service";
import { getClientIp } from "@/utils/request-ip";
import { TOKENS } from "@/types/tokens";
import { setRequestContextUserId } from "@/runtime/request-context";
import { createAdminOnlyMiddleware } from "@/middleware/admin-auth.middleware";

declare global {
  namespace Express {
    interface Request {
      decodedUser?: DecodedUser;
      adminContext?: AdminContext;
    }
  }
}

export { adminActionValidation } from "@/middleware/admin-action-validation.middleware";
export {
  adminRateLimit,
  forgotPasswordEmailRateLimit,
  forgotPasswordIpRateLimit,
  loginEmailRateLimit,
  loginIpRateLimit,
  registerIpRateLimit,
  resetPasswordIpRateLimit,
  verifyEmailAddressRateLimit,
  verifyEmailIpRateLimit,
} from "@/middleware/auth-rate-limits.middleware";

export abstract class AuthStrategy {
  abstract authenticate(req: Request): Promise<DecodedUser>;
}

export class BearerTokenStrategy extends AuthStrategy {
  constructor(
    private secret: string,
    private readonly authSessionService: AuthSessionService,
  ) {
    super();
  }

  async authenticate(req: Request): Promise<DecodedUser> {
    // Prefer secure httpOnly cookie but fall back to Authorization header if present
    let token: string | undefined =
      req.cookies?.[authCookieNames.accessToken] ||
      req.cookies?.[authCookieNames.legacyToken];
    if (!token) {
      // Some proxies may strip cookie; log incoming headers for diagnostics in dev
      if (process.env.NODE_ENV !== "production") {
        logger.debug("[AUTH][DEBUG] No token cookie header values available", {
          headerKeys: Object.keys(req.headers),
        });
      }
    }
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }
    if (!token) {
      logger.warn("Missing authentication token", {
        event: "auth.missing_token",
        method: req.method,
        route: req.originalUrl.split("?")[0],
        ip: getClientIp(req),
      });
      throw Errors.authentication("Missing token", {
        errorCode: ErrorCode.TOKEN_INVALID,
      });
    }
    try {
      const verified = jwt.verify(token, this.secret);
      if (typeof verified !== "object" || verified === null) {
        throw Errors.authentication("Invalid token payload", {
          errorCode: ErrorCode.TOKEN_INVALID,
        });
      }

      if (
        typeof verified.publicId !== "string" ||
        typeof verified.email !== "string" ||
        typeof verified.username !== "string" ||
        typeof verified.handle !== "string" ||
        typeof verified.sid !== "string"
      ) {
        throw Errors.authentication("Invalid token payload", {
          errorCode: ErrorCode.TOKEN_INVALID,
        });
      }

      const payload: DecodedUser = {
        publicId: asUserPublicId(verified.publicId),
        email: verified.email,
        username: verified.username,
        handle: verified.handle,
        sid: asSessionId(verified.sid),
        isAdmin:
          typeof verified.isAdmin === "boolean" ? verified.isAdmin : false,
      };

      const session = await this.authSessionService.assertAccessSession(
        verified.sid,
        verified.publicId,
      );
      if (typeof session.isEmailVerified === "boolean") {
        payload.isEmailVerified = session.isEmailVerified;
      } else if (typeof verified.isEmailVerified === "boolean") {
        payload.isEmailVerified = verified.isEmailVerified;
      }

      return payload;
    } catch (err) {
      if (isErrorWithStatusCode(err)) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("Token verification failed", {
        event: "auth.token_verification_failed",
        method: req.method,
        route: req.originalUrl.split("?")[0],
        reason: errorMessage,
      });
      const errorCode =
        err instanceof Error && err.name === "TokenExpiredError"
          ? ErrorCode.TOKEN_EXPIRED
          : ErrorCode.TOKEN_INVALID;
      const message =
        err instanceof Error && err.name === "TokenExpiredError"
          ? "Access token expired"
          : "Invalid token";
      throw Errors.authentication(message, { errorCode });
    }
  }
}

export class AuthenticationMiddleware {
  constructor(
    private strategy: AuthStrategy,
    private readonly userReadRepository: IUserReadRepository,
    private readonly metricsService: MetricsService | null,
  ) {}

  private async enforceActiveUser(decodedUser: DecodedUser): Promise<void> {
    const user = await this.userReadRepository.findByPublicId(
      decodedUser.publicId,
    );

    if (!user) {
      throw Errors.authentication("User not found", {
        errorCode: ErrorCode.UNAUTHORIZED,
      });
    }

    if (user.isBanned) {
      throw Errors.forbidden("Account banned", {
        context: {
          userId: decodedUser.publicId,
          banned: true,
        },
      });
    }

    if (user.isEmailVerified === false) {
      throw Errors.forbidden("Email verification required", {
        context: {
          userId: decodedUser.publicId,
          emailVerified: false,
        },
        errorCode: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    decodedUser.isAdmin = user.isAdmin;
    decodedUser.isEmailVerified = true;
  }

  private getOptionalAuthFailureReason(error: unknown): string {
    const message = getErrorMessage(error).toLowerCase();

    if (message.includes("missing token")) return "missing_token";
    if (message.includes("expired")) return "token_expired";
    if (message.includes("invalid token")) return "invalid_token";
    if (message.includes("email verification")) return "email_not_verified";
    if (message.includes("session")) return "invalid_session";

    const name = getErrorName(error);
    if (name) {
      return name.toLowerCase();
    }
    return "unknown";
  }

  private recordOptionalAuthFailure(req: Request, error: unknown): void {
    const reason = this.getOptionalAuthFailureReason(error);
    const route = `${req.baseUrl || ""}${req.path || req.originalUrl || "/"}`;

    if (reason !== "missing_token") {
      logger.warn("Optional authentication failed", {
        event: "auth.optional_failed",
        reason,
        route,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      this.metricsService?.recordOptionalAuthFailure(reason, route);
    } catch (metricsError) {
      logger.warn("Failed to record optional auth metric", {
        event: "auth.optional_metric_failed",
        error: metricsError,
      });
    }
  }

  handle(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.decodedUser = await this.strategy.authenticate(req);
        await this.enforceActiveUser(req.decodedUser);
        req.authSource = "access_token";
        req.authLogMetadata = {
          ...req.authLogMetadata,
          authState: "authenticated",
          authSource: "access_token",
          sessionId: req.decodedUser.sid,
          tokenFamilyId: req.decodedUser.sid,
        };
        setRequestContextUserId(req.decodedUser.publicId);
        next();
      } catch (error) {
        const reason = this.getOptionalAuthFailureReason(error);
        req.authLogMetadata = {
          ...req.authLogMetadata,
          authState: "auth_failed",
          authSource: reason === "missing_token" ? "none" : "access_token",
        };
        // Preserve original AppError Wwith statusCode
        if (isErrorWithStatusCode(error)) {
          return next(error);
        }
        const message = getErrorMessage(error) || "Unauthorized";
        // Default missing/other errors to AuthenticationError (401)
        next(
          Errors.authentication(message, { errorCode: ErrorCode.UNAUTHORIZED }),
        );
      }
    };
  }

  /**
   * Optional authentication - sets req.decodedUser if token is present and valid,
   * but doesn't throw an error if token is missing or invalid
   */
  handleOptional(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.decodedUser = await this.strategy.authenticate(req);
        await this.enforceActiveUser(req.decodedUser);
        req.authSource = "access_token";
        req.authLogMetadata = {
          ...req.authLogMetadata,
          authState: "authenticated",
          authSource: "access_token",
          sessionId: req.decodedUser.sid,
          tokenFamilyId: req.decodedUser.sid,
        };
        setRequestContextUserId(req.decodedUser.publicId);
      } catch (error) {
        req.decodedUser = undefined;
        const reason = this.getOptionalAuthFailureReason(error);
        if (reason !== "missing_token") {
          req.authLogMetadata = {
            ...req.authLogMetadata,
            authState: "auth_failed",
            authSource: "access_token",
          };
        }
        this.recordOptionalAuthFailure(req, error);
      }
      next();
    };
  }
}

@injectable()
export class AuthMiddlewareService {
  private readonly authenticationMiddleware: AuthenticationMiddleware;

  constructor(
    @inject(TOKENS.Services.AuthSession)
    private readonly authSessionService: AuthSessionService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw Errors.config("JWT_SECRET not configured");

    this.authenticationMiddleware = new AuthenticationMiddleware(
      new BearerTokenStrategy(secret, this.authSessionService),
      this.userReadRepository,
      this.metricsService,
    );
  }

  required(): RequestHandler {
    return this.authenticationMiddleware.handle();
  }

  optional(): RequestHandler {
    return this.authenticationMiddleware.handleOptional();
  }

  adminOnly(): RequestHandler {
    return createAdminOnlyMiddleware(this.userReadRepository);
  }
}
