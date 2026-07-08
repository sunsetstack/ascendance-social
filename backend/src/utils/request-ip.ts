import type { Request } from "express";

export const stripPort = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const closingBracketIndex = trimmed.indexOf("]");
    return closingBracketIndex === -1
      ? trimmed
      : trimmed.slice(1, closingBracketIndex);
  }

  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount !== 1) return trimmed;
  const lastColon = trimmed.lastIndexOf(":");
  const maybePort = trimmed.slice(lastColon + 1);
  return /^\d{1,5}$/.test(maybePort) ? trimmed.slice(0, lastColon) : trimmed;
};

export const getClientIp = (req: Request): string => {
  return stripPort(req.ip || req.socket.remoteAddress || "unknown");
};
