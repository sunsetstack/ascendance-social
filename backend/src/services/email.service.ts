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
  private readonly logOnly: boolean;

  constructor() {
    this.logOnly = process.env.EMAIL_DELIVERY_MODE === "log";
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = !this.logOnly && apiKey ? new Resend(apiKey) : null;
  }

  async sendPasswordResetEmail(
    recipientEmail: string,
    resetToken: string,
  ): Promise<void> {
    const link = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    if (this.logOnly) {
      this.logLocalEmail("password_reset", recipientEmail, link);
      return;
    }

    if (!this.resend) {
      logger.error("Email provider is not configured", {
        event: "email.provider.unconfigured",
        emailType: "password_reset",
      });
      throw Errors.internal("RESEND_API_KEY is not configured");
    }
    try {
      await this.resend.emails.send({
        from: "Ascendance <no-reply@ascendance.social>",
        to: recipientEmail,
        subject: "Password Reset Request",
        replyTo: "support@ascendance.social",
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
    const link = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&email=${encodeURIComponent(
      recipientEmail,
    )}`;
    if (this.logOnly) {
      this.logLocalEmail("email_verification", recipientEmail, link);
      return;
    }

    if (!this.resend) {
      logger.error("Email provider is not configured", {
        event: "email.provider.unconfigured",
        emailType: "email_verification",
      });
      throw Errors.internal("RESEND_API_KEY is not configured");
    }
    try {
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

  private logLocalEmail(
    emailType: "password_reset" | "email_verification",
    recipientEmail: string,
    previewUrl: string,
  ): void {
    logger.info("Email captured by local development delivery", {
      event: "email.local_delivery",
      emailType,
      recipientDomain: getEmailDomain(recipientEmail),
      previewUrl,
    });
  }
}
