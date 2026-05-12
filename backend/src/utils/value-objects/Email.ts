import { Errors } from "@/utils/errors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Value Object for validated email addresses.
 * Immutable — constructed via the static `of()` factory.
 *
 * `.value` is trimmed and lowercased to prevent duplicate accounts
 * from case variations like `User@x.com` vs `user@x.com`.
 */
export class Email {
  private constructor(public readonly value: string) {}

  static of(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      throw Errors.validation("Invalid email format", {
        context: { field: "email", value: normalized },
      });
    }
    return new Email(normalized);
  }

  toString(): string {
    return this.value;
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
