export interface NormalizedUserLike {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
}

export function pickString(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "";
}

export function normalizeUserLike(
  candidate: unknown,
): NormalizedUserLike | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const source = candidate as Record<string, unknown>;
  const profile =
    source.profile && typeof source.profile === "object"
      ? (source.profile as Record<string, unknown>)
      : undefined;

  const publicId = pickString(
    source.publicId ?? source.userPublicId ?? source.id,
  );
  if (!publicId) {
    return null;
  }

  return {
    publicId,
    handle: pickString(source.handle) || "",
    username: pickString(source.username ?? source.displayName) || "",
    avatar:
      pickString(source.avatar ?? source.avatarUrl ?? profile?.avatarUrl) || "",
  };
}
