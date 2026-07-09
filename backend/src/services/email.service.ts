import { injectable } from "tsyringe";
import { Resend } from "resend";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";

function getEmailDomain(email: string): string | undefined {
  return email.split("@")[1];
}

@injectable()
export class EmailService {
  private resend: Resend | null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendPasswordResetEmail(
    recipientEmail: string,
    resetToken: string,
  ): Promise<void> {
    if (!this.resend) {
      logger.error("Email provider is not configured", {
        event: "email.provider.unconfigured",
        emailType: "password_reset",
      });
      throw Errors.internal("RESEND_API_KEY is not configured");
    }
    try {
      const link = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
      await this.resend.emails.send({
        from: "noreply@ascendance.dev",
        to: recipientEmail,
        subject: "Password Reset Request",
        html: `<p>You requested a password reset. Click <a href="${link}">here</a> to reset your password.</p>`,
      });
      logger.info("Email sent", {
        event: "email.sent",
        emailType: "password_reset",
        recipientDomain: getEmailDomain(recipientEmail),
      });
    } catch (error) {
      logger.error("Failed to send email", {
        event: "email.send_failed",
        emailType: "password_reset",
        recipientDomain: getEmailDomain(recipientEmail),
        error,
      });
      throw Errors.internal("Failed to send password reset email");
    }
  }

  async sendEmailVerification(
    recipientEmail: string,
    verificationToken: string,
  ): Promise<void> {
    if (!this.resend) {
      logger.error("Email provider is not configured", {
        event: "email.provider.unconfigured",
        emailType: "email_verification",
      });
      throw Errors.internal("RESEND_API_KEY is not configured");
    }
    try {
      const link = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&email=${encodeURIComponent(
        recipientEmail,
      )}`;
      await this.resend.emails.send({
        from: "noreply@ascendance.dev",
        to: recipientEmail,
        subject: "Verify your email",
        html: `<p>Use this code to verify your email: <strong>${verificationToken}</strong></p><p>Or click <a href="${link}">here</a> to verify.</p>`,
      });
      logger.info("Email sent", {
        event: "email.sent",
        emailType: "email_verification",
        recipientDomain: getEmailDomain(recipientEmail),
      });
    } catch (error) {
      logger.error("Failed to send email", {
        event: "email.send_failed",
        emailType: "email_verification",
        recipientDomain: getEmailDomain(recipientEmail),
        error,
      });
      throw Errors.internal("Failed to send verification email");
    }
  }
}
