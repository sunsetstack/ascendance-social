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
  private readonly frontendUrl: string;

  constructor() {
    this.logOnly = process.env.EMAIL_DELIVERY_MODE === "log";
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const configuredFrontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, "");

    if (process.env.NODE_ENV === "production") {
      if (this.logOnly) {
        throw new Error("EMAIL_DELIVERY_MODE=log is not allowed in production");
      }
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required in production");
      }
      if (!configuredFrontendUrl) {
        throw new Error("FRONTEND_URL is required in production");
      }
      let parsedFrontendUrl: URL;
      try {
        parsedFrontendUrl = new URL(configuredFrontendUrl);
      } catch {
        throw new Error("FRONTEND_URL must be a valid URL");
      }
      if (parsedFrontendUrl.protocol !== "https:") {
        throw new Error("FRONTEND_URL must use HTTPS in production");
      }
    }

    this.frontendUrl = configuredFrontendUrl || "http://localhost:5173";
    this.resend = !this.logOnly && apiKey ? new Resend(apiKey) : null;
  }

  async sendPasswordResetEmail(
    recipientEmail: string,
    resetToken: string,
  ): Promise<void> {
    const link = `${this.frontendUrl}/reset-password#token=${encodeURIComponent(resetToken)}`;
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
    const link = `${this.frontendUrl}/verify-email#token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(
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

  async sendPasswordChangedEmail(recipientEmail: string): Promise<void> {
    if (this.logOnly) {
      this.logLocalEmail(
        "password_changed",
        recipientEmail,
        "Password changed notification",
      );
      return;
    }

    if (!this.resend) {
      logger.error("Email provider is not configured", {
        event: "email.provider.unconfigured",
        emailType: "password_changed",
      });
      throw Errors.internal("RESEND_API_KEY is not configured");
    }
    try {
      await this.resend.emails.send({
        from: "Ascendance <no-reply@ascendance.social>",
        to: recipientEmail,
        subject: "Your password was changed",
        replyTo: "support@ascendance.social",
        html: "<p>Your Ascendance password was changed.</p><p>If you did not make this change, reset your password immediately and contact support.</p>",
      });
      logger.info("Email sent", {
        event: "email.sent",
        emailType: "password_changed",
        recipientDomain: getEmailDomain(recipientEmail),
      });
    } catch (error) {
      logger.error("Failed to send email", {
        event: "email.send_failed",
        emailType: "password_changed",
        recipientDomain: getEmailDomain(recipientEmail),
        error,
      });
      throw Errors.internal("Failed to send password changed notification");
    }
  }

  private logLocalEmail(
    emailType: "password_reset" | "email_verification" | "password_changed",
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
