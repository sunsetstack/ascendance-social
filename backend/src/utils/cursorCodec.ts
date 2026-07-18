import { createHmac, timingSafeEqual } from "crypto";

export const decodeCursor = <T extends Record<string, unknown>>(
  cursor?: string,
): T | null => {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    // JSON.parse returns primitives, arrays, or objects - filter to only objects
    if (typeof decoded !== "object" || Array.isArray(decoded) || decoded === null) {
      return null;
    }
    return decoded as T;
  } catch {
    // Invalid base64 or malformed JSON - expected from user tampering
    return null;
  }
};

export const encodeCursor = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64");

export const encodeAuthenticatedCursor = (
  payload: Record<string, unknown>,
  secret: string,
): string => {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
};

export const decodeAuthenticatedCursor = <T extends Record<string, unknown>>(
  cursor: string,
  secret: string,
): T | null => {
  const separator = cursor.indexOf(".");
  if (separator <= 0 || separator !== cursor.lastIndexOf(".")) {
    return null;
  }

  const encodedPayload = cursor.slice(0, separator);
  const suppliedSignature = cursor.slice(separator + 1);
  if (!encodedPayload || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest();

  let suppliedSignatureBuffer: Buffer;
  try {
    suppliedSignatureBuffer = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }

  if (
    suppliedSignatureBuffer.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignatureBuffer, expectedSignature)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    );
    if (typeof decoded !== "object" || Array.isArray(decoded) || decoded === null) {
      return null;
    }
    return decoded as T;
  } catch {
    return null;
  }
};
