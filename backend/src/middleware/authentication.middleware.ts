import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { container } from "tsyringe";
import {
  Errors,
  ErrorCode,
  isErrorWithStatusCode,
  getErrorMessage,
  getErrorName,
} from "@/utils/errors";
import rateLimit from "express-rate-limit";
import { DecodedUser, AdminContext } from "@/types";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { logger } from "@/utils/winston";
import { authCookieNames } from "@/config/cookieConfig";
import { AuthSessionService } from "@/services/auth-session.service";
import { MetricsService } from "@/metrics/metrics.service";

declare global {
  namespace Express {
    interface Request {
      decodedUser?: DecodedUser;
      adminContext?: AdminContext;
    }
  }
}

export abstract class AuthStrategy {
  abstract authenticate(req: Request): Promise<DecodedUser>;
}

export class BearerTokenStrategy extends AuthStrategy {
  constructor(private secret: string) {
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
        logger.info(
          "[AUTH][DEBUG] No token cookie. Incoming headers:",
          req.headers,
        );
      }
    }
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }
    if (!token) {
      logger.warn(`[AUTH] Missing token for ${req.method} ${req.originalUrl}`);
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
        publicId: verified.publicId,
        email: verified.email,
        username: verified.username,
        handle: verified.handle,
        sid: verified.sid,
        isAdmin: typeof verified.isAdmin === "boolean" ? verified.isAdmin : false,
      };

      const authSessionService =
        container.resolve<AuthSessionService>("AuthSessionService");
      await authSessionService.assertAccessSession(
        verified.sid,
        verified.publicId,
      );

      logger.info(
        `[AUTH] User from token: ${payload.username} (${payload.publicId})`,
      );
      return payload;
    } catch (err) {
      if (isErrorWithStatusCode(err)) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("[AUTH] Token verification failed", errorMessage);
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
  constructor(private strategy: AuthStrategy) {}

  private async enforceVerifiedEmail(decodedUser: DecodedUser): Promise<void> {
    const userReadRepository =
      container.resolve<IUserReadRepository>("UserReadRepository");
    const user = await userReadRepository.findByPublicId(decodedUser.publicId);

    if (!user) {
      throw Errors.authentication("User not found", {
        errorCode: ErrorCode.UNAUTHORIZED,
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
      logger.warn("[AUTH][OPTIONAL] Authentication failed", {
        reason,
        route,
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const metricsService =
        container.resolve<MetricsService>("MetricsService");
      metricsService.recordOptionalAuthFailure(reason, route);
    } catch (metricsError) {
      logger.warn("[AUTH][OPTIONAL] Failed to record auth metric", {
        error:
          metricsError instanceof Error
            ? metricsError.message
            : String(metricsError),
      });
    }
  }

  handle(): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.decodedUser = await this.strategy.authenticate(req);
        await this.enforceVerifiedEmail(req.decodedUser);
        logger.info(
          `[AUTH] User authenticated: ${req.decodedUser.username} (${req.decodedUser.publicId})`,
        );
        next();
      } catch (error) {
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
        await this.enforceVerifiedEmail(req.decodedUser);
        logger.info(
          `[AUTH] Optional auth - User authenticated: ${req.decodedUser.username}`,
        );
      } catch (error) {
        req.decodedUser = undefined;
        this.recordOptionalAuthFailure(req, error);
      }
      next();
    };
  }
}

// Admin-specific rate limiting
export const adminRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 admin actions per 5 minutes
  message: "Too many admin actions, please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `admin-${req.decodedUser?.publicId || req.ip}`,
});

export const forgotPasswordIpRateLimit = rateLimit({
  windowMs: Number(process.env.FORGOT_PASSWORD_IP_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.FORGOT_PASSWORD_IP_MAX) || 5,
  message: "Too many password reset requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `forgot-password-ip:${req.ip}`,
});

export const forgotPasswordEmailRateLimit = rateLimit({
  windowMs:
    Number(process.env.FORGOT_PASSWORD_EMAIL_WINDOW_MS) || 60 * 60 * 1000,
  max: Number(process.env.FORGOT_PASSWORD_EMAIL_MAX) || 3,
  message: "Too many password reset requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    return `forgot-password-email:${email || "unknown"}`;
  },
});

// Enhanced admin-only middleware (requires authentication first)
export const enhancedAdminOnly = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const decodedUser = req.decodedUser;

    // Check authentication (should already be done by auth middleware)
    if (!decodedUser) {
      logger.warn(
        `[SECURITY] Unauthenticated admin access attempt from IP: ${req.ip}`,
      );
      return res.status(401).json({ error: "Authentication required" });
    }

    // Check admin privileges from JWT
    if (!decodedUser.isAdmin) {
      logger.warn(
        `[SECURITY] Unauthorized admin access attempt by user ${decodedUser.username} (${decodedUser.publicId}) from IP ${req.ip}`,
      );
      return res.status(403).json({ error: "Admin privileges required" });
    }

    // Fetch fresh user data from DB to check current ban status
    // JWT may have been issued before user was banned
    const userReadRepository =
      container.resolve<IUserReadRepository>("UserReadRepository");
    const user = await userReadRepository.findByPublicId(decodedUser.publicId);

    if (!user) {
      logger.warn(
        `[SECURITY] Admin user ${decodedUser.publicId} not found in database`,
      );
      return res.status(401).json({ error: "User not found" });
    }

    // Check if user is banned (from fresh DB data)
    if (user.isBanned) {
      logger.warn(
        `[SECURITY] Banned admin ${decodedUser.username} attempted access from IP ${req.ip}`,
      );
      return res.status(403).json({ error: "Account banned" });
    }

    // Verify admin status from DB as well (in case JWT was issued before admin revocation)
    if (!user.isAdmin) {
      logger.warn(
        `[SECURITY] User ${decodedUser.username} has admin JWT but is no longer admin in DB`,
      );
      return res.status(403).json({ error: "Admin privileges required" });
    }

    const adminEmailsEnv = process.env.ADMIN_EMAILS;
    if (adminEmailsEnv) {
      const allowedEmails = adminEmailsEnv
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0);

      if (user.email && !allowedEmails.includes(user.email.toLowerCase())) {
        logger.warn(
          `[SECURITY] Admin access denied for ${user.email} (not in ADMIN_EMAILS allowlist) from IP ${req.ip}`,
        );
        return res.status(403).json({ error: "Admin privileges restricted" });
      }
    }

    logger.info(
      `[ADMIN_AUDIT] ${decodedUser.username} (${decodedUser.publicId}) performing ${req.method} ${req.path} from IP ${req.ip}`,
    );

    // Add admin context to request
    req.adminContext = {
      adminId: decodedUser.publicId,
      adminUsername: decodedUser.username,
      timestamp: new Date(),
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    };

    next();
  } catch (error) {
    logger.error("[ADMIN_SECURITY] Admin middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Admin action validation middleware
export const adminActionValidation = (requiredFields: string[] = []) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Validate required fields
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
          requiredFields,
        });
      }
    }

    // Validate publicId format in params
    if (
      req.params.publicId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        req.params.publicId,
      )
    ) {
      return res.status(400).json({ error: "Invalid publicId format" });
    }

    next();
  };
};

// Factory for common authentication types
export class AuthFactory {
  static bearerToken(): AuthenticationMiddleware {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw Errors.config("JWT_SECRET not configured");

    return new AuthenticationMiddleware(new BearerTokenStrategy(secret));
  }

  static optionalBearerToken(): AuthenticationMiddleware {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw Errors.config("JWT_SECRET not configured");

    return new AuthenticationMiddleware(new BearerTokenStrategy(secret));
  }
}
