import { beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import crypto from "crypto";
import sinon, { SinonStub } from "sinon";
import { RequestPasswordResetHandler } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetHandler";
import { RequestPasswordResetCommand } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetCommand";
import { ResetPasswordHandler } from "@/application/commands/users/resetPassword/ResetPasswordHandler";
import { ResetPasswordCommand } from "@/application/commands/users/resetPassword/ResetPasswordCommand";

chai.use(chaiAsPromised);

describe("password reset handlers", () => {
  let userLookup: { findByEmail: SinonStub };
  let userWriteRepository: {
    update: SinonStub;
    consumePasswordResetToken: SinonStub;
  };
  let emailService: { sendPasswordResetEmail: SinonStub };
  let authService: { handlePasswordChanged: SinonStub };

  beforeEach(() => {
    userLookup = { findByEmail: sinon.stub() };
    userWriteRepository = {
      update: sinon.stub().resolves(),
      consumePasswordResetToken: sinon.stub(),
    };
    emailService = { sendPasswordResetEmail: sinon.stub().resolves() };
    authService = { handlePasswordChanged: sinon.stub().resolves() };
  });

  it("stores only a hash while sending the raw token to the user", async () => {
    const user = { id: "user-id", email: "user@example.com" };
    userLookup.findByEmail.resolves(user);
    const handler = new RequestPasswordResetHandler(
      userLookup as any,
      userWriteRepository as any,
      emailService as any,
    );

    await handler.execute(new RequestPasswordResetCommand(user.email));

    const storedToken = userWriteRepository.update.firstCall.args[1].resetToken;
    const sentToken = emailService.sendPasswordResetEmail.firstCall.args[1];
    expect(storedToken).to.equal(
      crypto.createHash("sha256").update(sentToken).digest("hex"),
    );
    expect(storedToken).to.not.equal(sentToken);
  });

  it("atomically consumes a valid token and handles the password change", async () => {
    const token = "reset-token";
    const user = {
      publicId: "user-public-id",
      email: "user@example.com",
    };
    userWriteRepository.consumePasswordResetToken.resolves(user);
    const handler = new ResetPasswordHandler(
      userWriteRepository as any,
      authService as any,
    );

    await handler.execute(new ResetPasswordCommand(token, "new-password"));

    expect(
      userWriteRepository.consumePasswordResetToken.calledOnceWith(
        crypto.createHash("sha256").update(token).digest("hex"),
        "new-password",
      ),
    ).to.equal(true);
    expect(authService.handlePasswordChanged.calledOnceWith(user)).to.equal(
      true,
    );
  });

  it("rejects an expired, invalid, or concurrently consumed token", async () => {
    userWriteRepository.consumePasswordResetToken.resolves(null);
    const handler = new ResetPasswordHandler(
      userWriteRepository as any,
      authService as any,
    );

    await expect(
      handler.execute(new ResetPasswordCommand("used-token", "new-password")),
    ).to.be.rejectedWith("Invalid or expired reset token");
    expect(authService.handlePasswordChanged.called).to.equal(false);
  });
});
