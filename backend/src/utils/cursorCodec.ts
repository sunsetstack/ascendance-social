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
