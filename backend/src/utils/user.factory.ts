import crypto from "crypto";

export interface UserRegistrationInput {
  handle: string;
  username: string;
  email: string;
  password: string;
  avatar?: string;
  cover?: string;
  ip?: string;
}

export interface UserRegistrationData {
  handle: string;
  handleNormalized: string;
  username: string;
  email: string;
  password: string;
  avatar?: string;
  cover?: string;
  registrationIp: string | undefined;
  lastIp: string | undefined;
  lastActive: Date;
  isEmailVerified: boolean;
  emailVerificationToken: string;
  emailVerificationExpires: Date;
}

/**
 * @pattern Factory
 *
 * Centralises all user-creation concerns that were previously inlined
 * in the RegisterUserCommandHandler.  Keeps the handler focused on
 * orchestration (uniqueness check → create → send email → seed bloom).
 */
export class UserFactory {
  static createFromRegistration(input: UserRegistrationInput): UserRegistrationData {
    const handle = input.handle.trim();
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    const emailVerificationToken = UserFactory.generateVerificationToken();
    const emailVerificationExpires = UserFactory.getVerificationExpiry();

    return {
      handle,
      handleNormalized: handle.toLowerCase(),
      username,
      email,
      password: input.password,
      // Omit avatar/cover when falsy so the Mongoose schema default applies.
      // Setting avatar: "" would override the default CDN URL with an empty string.
      ...(input.avatar ? { avatar: input.avatar } : {}),
      ...(input.cover ? { cover: input.cover } : {}),
      registrationIp: input.ip,
      lastIp: input.ip,
      lastActive: new Date(),
      isEmailVerified: false,
      emailVerificationToken,
      emailVerificationExpires,
    };
  }

  public static generateVerificationToken(): string {
    const value = crypto.randomInt(0, 100000);
    return value.toString().padStart(5, "0");
  }

  public static getVerificationExpiry(): Date {
    const ttlMinutes =
      Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES) || 60;
    return new Date(Date.now() + ttlMinutes * 60 * 1000);
  }
}
