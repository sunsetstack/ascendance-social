import { CookieOptions } from "express";

// Allow explicit override for COOKIE_SECURE=false when running production mode on plain HTTP in local docker
const explicitSecure = process.env.COOKIE_SECURE;
const secureFlag = explicitSecure !== undefined ? explicitSecure === "true" : process.env.NODE_ENV === "production";
const cookieDomain =
	process.env.NODE_ENV === "production" && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {};

const accessCookieMaxAge = Number(process.env.ACCESS_TOKEN_MAX_AGE_MS) || 1000 * 60 * 15;
const refreshCookieMaxAge = Number(process.env.REFRESH_TOKEN_MAX_AGE_MS) || 1000 * 60 * 60 * 24 * 30;
const refreshCookiePath = "/api/users/refresh";

const baseCookieOptions: CookieOptions = {
	httpOnly: true,
	secure: secureFlag,
	sameSite: secureFlag ? "none" : "lax",
	...cookieDomain,
};

export const authCookieNames = {
	accessToken: "access_token",
	refreshToken: "refresh_token",
	legacyToken: "token",
} as const;

export const accessCookieOptions: CookieOptions = {
	...baseCookieOptions,
	maxAge: accessCookieMaxAge,
	path: "/",
};

export const refreshCookieOptions: CookieOptions = {
	...baseCookieOptions,
	maxAge: refreshCookieMaxAge,
	path: refreshCookiePath,
};

export const clearAuthCookieOptions: CookieOptions = {
	...baseCookieOptions,
	path: "/",
};

export const clearRefreshCookieOptions: CookieOptions = {
	...baseCookieOptions,
	path: refreshCookiePath,
};
