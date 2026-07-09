const RESERVED_HANDLES = [
  "admin",
  "login",
  "register",
  "api",
  "dashboard",
  "settings",
  "help",
  "moderator",
  "user",
  "support",
  "about",
  "contact",
  "privacy",
  "terms",
  "profile",
] as const;

export function normalizeHandle(handle: string): {
  handle: string;
  handleNormalized: string;
} {
  const normalizedHandle = handle.trim();
  return {
    handle: normalizedHandle,
    handleNormalized: normalizedHandle.toLowerCase(),
  };
}

export function isReservedHandle(handleNormalized: string): boolean {
  return RESERVED_HANDLES.includes(
    handleNormalized as (typeof RESERVED_HANDLES)[number],
  );
}
