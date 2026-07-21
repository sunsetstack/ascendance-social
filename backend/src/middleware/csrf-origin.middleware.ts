import { Request, Response, NextFunction } from "express";
import { authCookieNames } from "@/config/cookieConfig";
import { isAllowedOrigin } from "@/config/corsConfig";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getRequestOrigin(req: Request): string | undefined {
  const origin = req.get("origin");
  if (origin) return origin;

  const referer = req.get("referer");
  if (!referer) return undefined;

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function hasAuthCookie(req: Request): boolean {
  return Boolean(
    req.cookies?.[authCookieNames.accessToken] ||
    req.cookies?.[authCookieNames.refreshToken] ||
    req.cookies?.[authCookieNames.legacyToken],
  );
}

export function csrfOriginMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method) || !hasAuthCookie(req)) {
    return next();
  }

  const requestOrigin = getRequestOrigin(req);
  if (isAllowedOrigin(requestOrigin)) {
    return next();
  }

  logger.warn("Blocked cookie-auth request with invalid origin", {
    event: "security.csrf_origin.blocked",
    method: req.method,
    route: req.originalUrl.split("?")[0],
    origin: requestOrigin,
  });

  next(Errors.forbidden("Invalid request origin"));
}
