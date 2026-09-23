import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import {
  Errors,
  ErrorCode,
  isAuthenticationError,
  AuthenticationForbiddenError,
} from "@/utils/errors";
import { DecodedUser, AdminContext } from "@/types";
import { asUserPublicId, asSessionId } from "@/types/branded";
import type { UserIdentityLookup } from "@/application/ports/user-identity-lookup";
import { logger } from "@/utils/winston";
import { authCookieNames } from "@/config/cookieConfig";
import { AuthSessionService } from "@/services/auth-session.service";
import { MetricsService } from "@/metrics/metrics.service";
import { TOKENS } from "@/types/tokens";
import { setRequestContextAuthentication } from "@/runtime/request-context";
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

function isExpectedJwtVerificationError(
  error: unknown,
): error is jwt.JsonWebTokenError {
  return error instanceof jwt.JsonWebTokenError;
}

function hasPresentedAccessToken(req: Request): boolean {
  return Boolean(
    req.cookies?.[authCookieNames.accessToken] ||
    req.cookies?.[authCookieNames.legacyToken] ||
    req.headers.authorization?.startsWith("Bearer "),
  );
}

function isExpectedOptionalAuthenticationRejection(error: unknown): boolean {
  return (
    isAuthenticationError(error) ||
    (error instanceof AuthenticationForbiddenError &&
      error.errorCode === ErrorCode.EMAIL_NOT_VERIFIED) ||
    isExpectedJwtVerificationError(error)
  );
}

function clearOptionalAuthenticationState(req: Request): void {
  req.decodedUser = undefined;
  req.authSource = undefined;
  req.authLogMetadata = undefined;
}

export interface RequiredAuthOptions {
  allowUnverified?: boolean;
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
        typeof verified.sid !== "string" ||
        typeof verified.exp !== "number" ||
        !Number.isFinite(verified.exp)
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
        exp: verified.exp,
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
    } catch (error) {
      if (isAuthenticationError(error)) {
        throw error;
      }

      if (!isExpectedJwtVerificationError(error)) {
        throw error;
      }

      logger.warn("Token verification failed", {
        event: "auth.token_verification_failed",
        method: req.method,
        route: req.originalUrl.split("?")[0],
        reason: error.name,
      });
      const errorCode =
        error instanceof jwt.TokenExpiredError
          ? ErrorCode.TOKEN_EXPIRED
          : ErrorCode.TOKEN_INVALID;
      const message =
        error instanceof jwt.TokenExpiredError
          ? "Access token expired"
          : "Invalid token";
      throw Errors.authentication(message, { errorCode, cause: error });
    }
  }
}

export class AuthenticationMiddleware {
  constructor(
    private strategy: AuthStrategy,
    private readonly userReadRepository: UserIdentityLookup,
    private readonly metricsService: MetricsService | null,
  ) {}

  async enforceActiveUser(
    decodedUser: DecodedUser,
    options: RequiredAuthOptions = {},
  ): Promise<void> {
    const user = await this.userReadRepository.findByPublicId(
      decodedUser.publicId,
    );

    if (!user) {
      throw Errors.authentication("User not found", {
        errorCode: ErrorCode.UNAUTHORIZED,
      });
    }

    if (user.isBanned) {
      throw Errors.authenticationForbidden("Account banned", {
        context: {
          userId: decodedUser.publicId,
          banned: true,
        },
      });
    }

    if (!options.allowUnverified && user.isEmailVerified === false) {
      throw Errors.authenticationForbidden("Email verification required", {
        context: {
          userId: decodedUser.publicId,
          emailVerified: false,
        },
        errorCode: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    decodedUser.isAdmin = user.isAdmin;
    decodedUser.isEmailVerified = user.isEmailVerified !== false;
  }

  private getOptionalAuthFailureReason(req: Request, error: unknown): string {
    if (!hasPresentedAccessToken(req) && isAuthenticationError(error)) {
      return "missing_token";
    }
    const jwtError = isAuthenticationError(error) ? error.cause : error;
    if (jwtError instanceof jwt.TokenExpiredError) return "token_expired";
    if (jwtError instanceof jwt.NotBeforeError) return "token_not_active";
    if (jwtError instanceof jwt.JsonWebTokenError) return "invalid_token";

    return "authentication_failed";
  }

  private recordOptionalAuthFailure(req: Request, error: unknown): void {
    const reason = this.getOptionalAuthFailureReason(req, error);
    const route = `${req.baseUrl || ""}${req.path || req.originalUrl || "/"}`;

    if (reason !== "missing_token") {
      logger.warn("Optional authentication failed", {
        event: "auth.optional_failed",
        reason,
        route,
        method: req.method,
        error,
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

  handle(options: RequiredAuthOptions = {}): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.decodedUser = await this.strategy.authenticate(req);
        await this.enforceActiveUser(req.decodedUser, options);
        req.authSource = "access_token";
        req.authLogMetadata = {
          ...req.authLogMetadata,
          authState: "authenticated",
          authSource: "access_token",
          sessionId: req.decodedUser.sid,
          tokenFamilyId: req.decodedUser.sid,
        };
        setRequestContextAuthentication({
          userId: req.decodedUser.publicId,
          sessionId: req.decodedUser.sid,
          tokenFamilyId: req.decodedUser.sid,
          authSource: "access_token",
        });
        next();
      } catch (error) {
        req.authLogMetadata = {
          ...req.authLogMetadata,
          authState: "auth_failed",
          authSource: hasPresentedAccessToken(req) ? "access_token" : "none",
        };
        next(error);
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
        setRequestContextAuthentication({
          userId: req.decodedUser.publicId,
          sessionId: req.decodedUser.sid,
          tokenFamilyId: req.decodedUser.sid,
          authSource: "access_token",
        });
      } catch (error) {
        if (!isExpectedOptionalAuthenticationRejection(error)) {
          return next(error);
        }

        clearOptionalAuthenticationState(req);
        const reason = this.getOptionalAuthFailureReason(req, error);
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
    @inject(TOKENS.Repositories.UserIdentityLookup)
    private readonly userReadRepository: UserIdentityLookup,
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

  required(options: RequiredAuthOptions = {}): RequestHandler {
    return this.authenticationMiddleware.handle(options);
  }

  async assertActiveSession(user: DecodedUser): Promise<void> {
    if (
      !user.sid ||
      typeof user.exp !== "number" ||
      !Number.isFinite(user.exp) ||
      user.exp * 1000 <= Date.now()
    ) {
      throw Errors.authentication("Session is invalid or expired");
    }

    await this.authSessionService.assertAccessSession(user.sid, user.publicId);
    await this.authenticationMiddleware.enforceActiveUser(user);
  }

  optional(): RequestHandler {
    return this.authenticationMiddleware.handleOptional();
  }

  adminOnly(): RequestHandler {
    return createAdminOnlyMiddleware(this.userReadRepository);
  }
}
