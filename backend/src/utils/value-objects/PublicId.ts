import { Errors } from "@/utils/errors";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Value Object for validated UUID v4 public identifiers.
 * Immutable — constructed via the static `of()` factory.
 */
export class PublicId {
  private constructor(public readonly value: string) {}

  static of(raw: string): PublicId {
    if (!raw || !UUID_V4_REGEX.test(raw)) {
      throw Errors.validation("Invalid publicId format", {
        context: { field: "publicId", value: raw },
      });
    }
    return new PublicId(raw);
  }

  toString(): string {
    return this.value;
  }

  equals(other: PublicId): boolean {
    return this.value === other.value;
  }
}
