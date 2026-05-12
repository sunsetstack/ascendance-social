import { Errors } from "@/utils/errors";

const HANDLE_REGEX = /^[a-zA-Z0-9._]{1,50}$/;

/**
 * Value Object for validated user handles.
 * Immutable — constructed via the static `of()` factory.
 *
 * Exposes:
 *  - `.display`    — trimmed original casing
 *  - `.normalized` — lowercase for uniqueness checks
 */
export class Handle {
  private constructor(
    public readonly display: string,
    public readonly normalized: string,
  ) {}

  static of(raw: string): Handle {
    const trimmed = raw.trim();
    if (!HANDLE_REGEX.test(trimmed)) {
      throw Errors.validation("Invalid handle format", {
        context: { field: "handle", value: trimmed },
      });
    }
    return new Handle(trimmed, trimmed.toLowerCase());
  }

  toString(): string {
    return this.display;
  }

  equals(other: Handle): boolean {
    return this.normalized === other.normalized;
  }
}
