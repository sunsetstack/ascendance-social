const MAX_OBSERVED_URL_LENGTH = 2_048;
const UNSAFE_URL_CHARACTER = /[\u0000-\u001f\u007f\\]/;

export function sanitizeObservedUrl(
  value: string | undefined,
  kind: "origin" | "referer",
): string | undefined {
  const raw = value?.trim();
  if (!raw || UNSAFE_URL_CHARACTER.test(raw)) {
    return undefined;
  }

  const isRelativePath = raw.startsWith("/") && !raw.startsWith("//");
  if (kind === "origin" && isRelativePath) {
    return undefined;
  }

  let parsed: URL;
  try {
    if (isRelativePath) {
      parsed = new URL(raw, "https://request.invalid");
    } else {
      if (!/^https?:\/\//i.test(raw)) {
        return undefined;
      }
      parsed = new URL(raw);
    }
  } catch {
    return undefined;
  }

  if (
    parsed.username ||
    parsed.password ||
    (isRelativePath && parsed.origin !== "https://request.invalid")
  ) {
    return undefined;
  }

  if (kind === "origin" && parsed.pathname !== "/") {
    return undefined;
  }

  const sanitized = isRelativePath
    ? parsed.pathname
    : kind === "origin"
      ? parsed.origin
      : `${parsed.origin}${parsed.pathname}`;
  return sanitized.slice(0, MAX_OBSERVED_URL_LENGTH);
}
