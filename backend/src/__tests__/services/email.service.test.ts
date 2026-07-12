import { expect } from "chai";
import sinon from "sinon";
import { EmailService } from "@/services/email.service";
import { logger } from "@/utils/winston";

describe("EmailService", () => {
  const originalDeliveryMode = process.env.EMAIL_DELIVERY_MODE;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalResendApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.EMAIL_DELIVERY_MODE = "log";
    process.env.FRONTEND_URL = "http://localhost:8080";
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    sinon.restore();
    restoreEnv("EMAIL_DELIVERY_MODE", originalDeliveryMode);
    restoreEnv("FRONTEND_URL", originalFrontendUrl);
    restoreEnv("RESEND_API_KEY", originalResendApiKey);
  });

  it("logs email verification URLs without a Resend API key", async () => {
    const logStub = sinon.stub(logger, "info");
    const service = new EmailService();

    await service.sendEmailVerification("dev@example.com", "12345");

    expect(logStub.calledOnce).to.equal(true);
    const [, metadata] = logStub.firstCall.args as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(metadata).to.deep.include({
      event: "email.local_delivery",
      emailType: "email_verification",
      recipientDomain: "example.com",
      previewUrl:
        "http://localhost:8080/verify-email?token=12345&email=dev%40example.com",
    });
  });

  it("logs password reset URLs without a Resend API key", async () => {
    const logStub = sinon.stub(logger, "info");
    const service = new EmailService();

    await service.sendPasswordResetEmail("dev@example.com", "reset-token");

    expect(logStub.calledOnce).to.equal(true);
    const [, metadata] = logStub.firstCall.args as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(metadata).to.deep.include({
      event: "email.local_delivery",
      emailType: "password_reset",
      recipientDomain: "example.com",
      previewUrl:
        "http://localhost:8080/reset-password?token=reset-token",
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
