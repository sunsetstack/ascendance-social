import { expect } from "chai";
import { isAllowedOrigin } from "@/config/corsConfig";

describe("origin policy", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it("accepts only the exact canonical configured origin", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://allowed.example";

    expect(isAllowedOrigin("https://allowed.example")).to.equal(true);
    expect(isAllowedOrigin("https://allowed.example.attacker.test")).to.equal(
      false,
    );
    expect(isAllowedOrigin("https://allowed.example/path")).to.equal(false);
    expect(isAllowedOrigin("https://allowed.example?query=1")).to.equal(false);
    expect(isAllowedOrigin("https://user:pass@allowed.example")).to.equal(
      false,
    );
    expect(isAllowedOrigin("not-an-origin")).to.equal(false);
    expect(isAllowedOrigin("null")).to.equal(false);
  });

  it("fails closed for an empty production allowlist", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOWED_ORIGINS;

    expect(isAllowedOrigin("https://allowed.example")).to.equal(false);
  });

  it("keeps configured local-development origins available", () => {
    process.env.NODE_ENV = "development";
    delete process.env.ALLOWED_ORIGINS;

    expect(isAllowedOrigin("http://localhost:5173")).to.equal(true);
  });
});
