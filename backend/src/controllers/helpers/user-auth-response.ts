import { Request, Response } from "express";
import {
  accessCookieOptions,
  authCookieNames,
  clearAuthCookieOptions,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from "@/config/cookieConfig";
import { AdminUserDTO, AuthenticatedUserDTO } from "@/services/dto.service";
import { UserPublicId } from "@/types/branded";
import { getClientIp } from "@/utils/request-ip";

export type AuthRequestContext = {
  ip: string;
  userAgent: string;
};

export type SessionUser = {
  publicId: UserPublicId;
  email: string;
  handle: string;
  username: string;
  isAdmin: boolean;
  isEmailVerified: boolean;
};

export function buildAuthRequestContext(req: Request): AuthRequestContext {
  return {
    ip: getClientIp(req),
    userAgent: req.get("User-Agent") || "unknown",
  };
}

export function toSessionUser(
  user: AuthenticatedUserDTO | AdminUserDTO,
): SessionUser {
  return {
    publicId: user.publicId,
    email: user.email,
    handle: user.handle,
    username: user.username,
    isAdmin: "isAdmin" in user ? Boolean(user.isAdmin) : false,
    isEmailVerified: user.isEmailVerified,
  };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(authCookieNames.accessToken, accessToken, accessCookieOptions);
  res.cookie(authCookieNames.refreshToken, refreshToken, refreshCookieOptions);
  res.clearCookie(authCookieNames.legacyToken, clearAuthCookieOptions);
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(authCookieNames.accessToken, clearAuthCookieOptions);
  res.clearCookie(authCookieNames.refreshToken, clearRefreshCookieOptions);
  res.clearCookie(authCookieNames.legacyToken, clearAuthCookieOptions);
}
