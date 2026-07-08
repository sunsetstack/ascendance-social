import rateLimit from "express-rate-limit";
import { getRateLimitStoreOptions } from "@/config/rateLimit";
import { getClientIp } from "@/utils/request-ip";

const isTestEnv = process.env.NODE_ENV === "test";

export const adminRateLimit = rateLimit({
  ...getRateLimitStoreOptions("admin", { passOnStoreError: false }),
  windowMs: 5 * 60 * 1000,
  max: 50,
  message: "Too many admin actions, please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `admin-${req.decodedUser?.publicId || getClientIp(req)}`,
});

export const registerIpRateLimit = rateLimit({
  ...getRateLimitStoreOptions("register-ip", { passOnStoreError: false }),
  windowMs: Number(process.env.REGISTER_IP_WINDOW_MS) || 60 * 60 * 1000,
  max: Number(process.env.REGISTER_IP_MAX) || (isTestEnv ? 1000 : 5),
  message: "Too many registration attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `register-ip:${getClientIp(req)}`,
});

export const loginIpRateLimit = rateLimit({
  ...getRateLimitStoreOptions("login-ip", { passOnStoreError: false }),
  windowMs: Number(process.env.LOGIN_IP_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_IP_MAX) || (isTestEnv ? 1000 : 20),
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `login-ip:${getClientIp(req)}`,
});

export const loginEmailRateLimit = rateLimit({
  ...getRateLimitStoreOptions("login-email", { passOnStoreError: false }),
  windowMs: Number(process.env.LOGIN_EMAIL_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_EMAIL_MAX) || (isTestEnv ? 1000 : 5),
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    return `login-email:${email || "unknown"}`;
  },
});

export const forgotPasswordIpRateLimit = rateLimit({
  ...getRateLimitStoreOptions("forgot-password-ip", {
    passOnStoreError: false,
  }),
  windowMs: Number(process.env.FORGOT_PASSWORD_IP_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.FORGOT_PASSWORD_IP_MAX) || 5,
  message: "Too many password reset requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `forgot-password-ip:${getClientIp(req)}`,
});

export const forgotPasswordEmailRateLimit = rateLimit({
  ...getRateLimitStoreOptions("forgot-password-email", {
    passOnStoreError: false,
  }),
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

export const resetPasswordIpRateLimit = rateLimit({
  ...getRateLimitStoreOptions("reset-password-ip", {
    passOnStoreError: false,
  }),
  windowMs: Number(process.env.RESET_PASSWORD_IP_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RESET_PASSWORD_IP_MAX) || (isTestEnv ? 1000 : 10),
  message: "Too many password reset attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `reset-password-ip:${getClientIp(req)}`,
});

export const verifyEmailIpRateLimit = rateLimit({
  ...getRateLimitStoreOptions("verify-email-ip", {
    passOnStoreError: false,
  }),
  windowMs: Number(process.env.VERIFY_EMAIL_IP_WINDOW_MS) || 60 * 60 * 1000,
  max: Number(process.env.VERIFY_EMAIL_IP_MAX) || (isTestEnv ? 1000 : 20),
  message: "Too many email verification attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `verify-email-ip:${getClientIp(req)}`,
});

export const verifyEmailAddressRateLimit = rateLimit({
  ...getRateLimitStoreOptions("verify-email-address", {
    passOnStoreError: false,
  }),
  windowMs:
    Number(process.env.VERIFY_EMAIL_ADDRESS_WINDOW_MS) || 60 * 60 * 1000,
  max: Number(process.env.VERIFY_EMAIL_ADDRESS_MAX) || (isTestEnv ? 1000 : 5),
  message: "Too many email verification attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    return `verify-email-address:${email || "unknown"}`;
  },
});
