import { expect } from "chai";
import sinon from "sinon";
import { Resend } from "resend";
import { EmailService } from "@/services/email.service";
import { AppError } from "@/utils/errors";
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
        "http://localhost:8080/verify-email#token=12345&email=dev%40example.com",
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
        "http://localhost:8080/reset-password#token=reset-token",
    });
  });

  describe("provider delivery", () => {
    beforeEach(() => {
      delete process.env.EMAIL_DELIVERY_MODE;
      process.env.RESEND_API_KEY = "re_test_api_key";
    });

    const emailCases = [
      {
        emailType: "password_reset",
        subject: "Password Reset Request",
        failureMessage: "Failed to send password reset email",
        send: (service: EmailService) =>
          service.sendPasswordResetEmail("dev@example.com", "reset-token"),
      },
      {
        emailType: "email_verification",
        subject: "Verify your email",
        failureMessage: "Failed to send verification email",
        send: (service: EmailService) =>
          service.sendEmailVerification("dev@example.com", "12345"),
      },
      {
        emailType: "password_changed",
        subject: "Your password was changed",
        failureMessage: "Failed to send password changed notification",
        send: (service: EmailService) =>
          service.sendPasswordChangedEmail("dev@example.com"),
      },
    ];

    for (const emailCase of emailCases) {
      it(`logs ${emailCase.emailType} success after provider acceptance`, async () => {
        const sendStub = sinon.stub(Resend.prototype, "post").resolves({
          data: { id: "accepted-email" },
          error: null,
          headers: null,
        });
        const infoStub = sinon.stub(logger, "info");
        const errorStub = sinon.stub(logger, "error");
        const service = new EmailService();

        await emailCase.send(service);

        sinon.assert.calledOnce(sendStub);
        expect(sendStub.firstCall.args[0]).to.equal("/emails");
        expect(sendStub.firstCall.args[1]).to.include({
          from: "Ascendance <no-reply@ascendance.social>",
          to: "dev@example.com",
          subject: emailCase.subject,
        });
        sinon.assert.calledOnce(infoStub);
        const [, metadata] = infoStub.firstCall.args as unknown as [
          string,
          Record<string, unknown>,
        ];
        expect(metadata).to.deep.include({
          event: "email.sent",
          emailType: emailCase.emailType,
          recipientDomain: "example.com",
        });
        sinon.assert.notCalled(errorStub);
      });

      for (const failureMode of ["resolved error", "rejected promise"] as const) {
        it(`rejects ${emailCase.emailType} on a provider ${failureMode} without logging success`, async () => {
          const resolvedError = {
            name: "validation_error" as const,
            message: "Provider rejected the email",
            statusCode: 422,
          };
          const providerError = failureMode === "resolved error"
            ? resolvedError
            : new Error("Provider connection failed");
          const sendStub = sinon.stub(Resend.prototype, "post");
          if (failureMode === "resolved error") {
            sendStub.resolves({ data: null, error: resolvedError, headers: null });
          } else {
            sendStub.rejects(providerError);
          }
          const infoStub = sinon.stub(logger, "info");
          const errorStub = sinon.stub(logger, "error");
          const service = new EmailService();

          const [result] = await Promise.allSettled([emailCase.send(service)]);

          expect(result.status).to.equal("rejected");
          if (result.status !== "rejected") throw new Error("Expected email failure");
          expect(result.reason).to.be.instanceOf(AppError);
          expect(result.reason.message).to.equal(emailCase.failureMessage);
          expect(result.reason.statusCode).to.equal(500);
          sinon.assert.calledOnce(sendStub);
          sinon.assert.notCalled(infoStub);
          sinon.assert.calledOnce(errorStub);
          const [, metadata] = errorStub.firstCall.args as unknown as [
            string,
            Record<string, unknown>,
          ];
          expect(metadata).to.deep.include({
            event: "email.send_failed",
            emailType: emailCase.emailType,
            recipientDomain: "example.com",
            error: providerError,
          });
        });
      }
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
