import { expect } from "chai";
import { UserFactory, UserRegistrationInput } from "@/utils/user.factory";

const DEFAULT_AVATAR_URL =
  "https://res.cloudinary.com/dfyqaqnj7/image/upload/v1737562142/defaultAvatar_evsmmj.jpg";

function makeInput(
  overrides: Partial<UserRegistrationInput> = {},
): UserRegistrationInput {
  return {
    handle: "testhandle",
    username: "Test User",
    email: "test@example.com",
    password: "secret123",
    ip: "127.0.0.1",
    ...overrides,
  };
}

describe("UserFactory", () => {
  describe("createFromRegistration", () => {
    it("trims whitespace from handle", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ handle: "  myHandle  " }),
      );
      expect(result.handle).to.equal("myHandle");
    });

    it("sets handleNormalized to lowercased trimmed handle", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ handle: "  MyHandle  " }),
      );
      expect(result.handleNormalized).to.equal("myhandle");
    });

    it("trims whitespace from username", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ username: "  Cool User  " }),
      );
      expect(result.username).to.equal("Cool User");
    });

    it("lowercases email", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ email: "User@Example.COM" }),
      );
      expect(result.email).to.equal("user@example.com");
    });

    it("trims whitespace from email", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ email: "  user@example.com  " }),
      );
      expect(result.email).to.equal("user@example.com");
    });

    it("normalises email with mixed case and surrounding spaces", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ email: "  USER@EXAMPLE.COM  " }),
      );
      expect(result.email).to.equal("user@example.com");
    });

    it("passes password through unchanged", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ password: "P@ssw0rd!" }),
      );
      expect(result.password).to.equal("P@ssw0rd!");
    });

    it("omits avatar when not provided so the Mongoose schema default applies", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ avatar: undefined }),
      );
      expect(result).to.not.have.property("avatar");
    });

    it("omits avatar when provided as empty string", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ avatar: "" }),
      );
      expect(result).to.not.have.property("avatar");
    });

    it("includes avatar when a non-empty value is provided", () => {
      const url = "https://cdn.example.com/my-avatar.jpg";
      const result = UserFactory.createFromRegistration(
        makeInput({ avatar: url }),
      );
      expect(result.avatar).to.equal(url);
    });

    it("omits cover when not provided so the Mongoose schema default applies", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ cover: undefined }),
      );
      expect(result).to.not.have.property("cover");
    });

    it("omits cover when provided as empty string", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ cover: "" }),
      );
      expect(result).to.not.have.property("cover");
    });

    it("includes cover when a non-empty value is provided", () => {
      const url = "https://cdn.example.com/my-cover.jpg";
      const result = UserFactory.createFromRegistration(
        makeInput({ cover: url }),
      );
      expect(result.cover).to.equal(url);
    });

    it("sets registrationIp from input.ip", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ ip: "1.2.3.4" }),
      );
      expect(result.registrationIp).to.equal("1.2.3.4");
    });

    it("sets lastIp from input.ip", () => {
      const result = UserFactory.createFromRegistration(
        makeInput({ ip: "1.2.3.4" }),
      );
      expect(result.lastIp).to.equal("1.2.3.4");
    });

    it("sets lastActive to a recent Date", () => {
      const before = Date.now();
      const result = UserFactory.createFromRegistration(makeInput());
      const after = Date.now();
      expect(result.lastActive).to.be.instanceOf(Date);
      expect(result.lastActive.getTime()).to.be.within(before, after);
    });

    it("sets isEmailVerified to false", () => {
      const result = UserFactory.createFromRegistration(makeInput());
      expect(result.isEmailVerified).to.equal(false);
    });

    it("produces a 5-digit zero-padded emailVerificationToken", () => {
      const result = UserFactory.createFromRegistration(makeInput());
      expect(result.emailVerificationToken).to.match(/^\d{5}$/);
    });

    it("sets emailVerificationExpires to a future Date", () => {
      const now = Date.now();
      const result = UserFactory.createFromRegistration(makeInput());
      expect(result.emailVerificationExpires).to.be.instanceOf(Date);
      expect(result.emailVerificationExpires.getTime()).to.be.greaterThan(now);
    });

    it("respects EMAIL_VERIFICATION_TOKEN_TTL_MINUTES env var for expiry", () => {
      process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES = "30";
      const before = Date.now();
      const result = UserFactory.createFromRegistration(makeInput());
      const after = Date.now();
      delete process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES;

      const expectedMin = before + 30 * 60 * 1000;
      const expectedMax = after + 30 * 60 * 1000;
      expect(result.emailVerificationExpires.getTime()).to.be.within(
        expectedMin,
        expectedMax,
      );
    });

    it("falls back to 60-minute expiry when env var is absent", () => {
      delete process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES;
      const before = Date.now();
      const result = UserFactory.createFromRegistration(makeInput());
      const after = Date.now();

      const expectedMin = before + 60 * 60 * 1000;
      const expectedMax = after + 60 * 60 * 1000;
      expect(result.emailVerificationExpires.getTime()).to.be.within(
        expectedMin,
        expectedMax,
      );
    });
  });

  describe("generateVerificationToken", () => {
    it("always produces a 5-character numeric string", () => {
      for (let i = 0; i < 20; i++) {
        const token = UserFactory.generateVerificationToken();
        expect(token).to.match(/^\d{5}$/);
      }
    });

    it("is exactly 5 characters long on every call", () => {
      for (let i = 0; i < 20; i++) {
        expect(UserFactory.generateVerificationToken()).to.have.lengthOf(5);
      }
    });
  });

  describe("getVerificationExpiry", () => {
    it("returns a Date in the future", () => {
      const expiry = UserFactory.getVerificationExpiry();
      expect(expiry).to.be.instanceOf(Date);
      expect(expiry.getTime()).to.be.greaterThan(Date.now());
    });

    it("respects EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=120", () => {
      process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES = "120";
      const before = Date.now();
      const expiry = UserFactory.getVerificationExpiry();
      const after = Date.now();
      delete process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES;

      const expectedMin = before + 120 * 60 * 1000;
      const expectedMax = after + 120 * 60 * 1000;
      expect(expiry.getTime()).to.be.within(expectedMin, expectedMax);
    });
  });
});
