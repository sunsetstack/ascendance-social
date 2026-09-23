import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export type TrustProxy = (address: string, hop: number) => boolean;

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
  return stripPort(req.ip || req.socket?.remoteAddress || "unknown");
};

export const getIpRateLimitKey = (req: Request): string => {
  return ipKeyGenerator(getClientIp(req), 56);
};

export function getSocketIpRateLimitKey(
  req: IncomingMessage,
  trustProxy: TrustProxy,
): string {
  let address = req.socket.remoteAddress || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const hops = forwarded.split(",").reverse();
    for (let hop = 0; hop < hops.length; hop += 1) {
      if (!isIP(address) || !trustProxy(address, hop)) break;
      const nextAddress = stripPort(hops[hop]!);
      if (!isIP(nextAddress)) break;
      address = nextAddress;
    }
  }
  return ipKeyGenerator(address, 56);
}
