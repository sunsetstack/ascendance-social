import type { Request } from "express";

export const stripPort = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) return trimmed;

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return trimmed;

  const maybePort = trimmed.slice(lastColon + 1);
  return /^\d{1,5}$/.test(maybePort)
    ? trimmed.slice(0, lastColon)
    : trimmed;
};

export const getClientIp = (req: Request): string => {
  const xForwardedFor = req.headers["x-forwarded-for"];
  const forwardedIps =
    typeof xForwardedFor === "string" && xForwardedFor.trim()
      ? xForwardedFor
          .split(",")
          .map((value) => stripPort(value))
          .filter((value) => value.length > 0)
      : [];
  const firstForwardedIp = forwardedIps[0];

  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (typeof cfConnectingIp === "string" && cfConnectingIp.trim()) {
    const normalizedCfIp = stripPort(cfConnectingIp);
    if (
      firstForwardedIp &&
      firstForwardedIp !== normalizedCfIp &&
      forwardedIps.includes(normalizedCfIp)
    ) {
      return firstForwardedIp;
    }
    return normalizedCfIp;
  }

  const trueClientIp = req.headers["true-client-ip"];
  if (typeof trueClientIp === "string" && trueClientIp.trim()) {
    return stripPort(trueClientIp);
  }

  const xRealIp = req.headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim()) {
    return stripPort(xRealIp);
  }

  if (firstForwardedIp) {
    return firstForwardedIp;
  }

  return stripPort(req.ip || req.socket.remoteAddress || "unknown");
};
