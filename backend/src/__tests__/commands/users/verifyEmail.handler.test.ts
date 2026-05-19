import { describe, beforeEach, it } from "mocha";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import chai from "chai";
import sinon, { SinonStub } from "sinon";
import { VerifyEmailHandler } from "@/application/commands/users/verifyEmail/VerifyEmailHandler";
import { VerifyEmailCommand } from "@/application/commands/users/verifyEmail/VerifyEmailCommand";

chai.use(chaiAsPromised);

describe("VerifyEmailHandler", () => {
	let handler: VerifyEmailHandler;
	let mockUserReadRepository: {
		findByEmailVerificationToken: SinonStub;
	};
	let mockUserWriteRepository: {
		update: SinonStub;
	};
	let mockDtoService: {
		toAuthenticatedUserDTO: SinonStub;
		toAdminDTO: SinonStub;
	};
	let mockAuthSessionService: {
		markUserEmailVerified: SinonStub;
	};

	beforeEach(() => {
		mockUserReadRepository = {
			findByEmailVerificationToken: sinon.stub(),
		};
		mockUserWriteRepository = {
			update: sinon.stub(),
		};
		mockDtoService = {
			toAuthenticatedUserDTO: sinon.stub(),
			toAdminDTO: sinon.stub(),
		};
		mockAuthSessionService = {
			markUserEmailVerified: sinon.stub().resolves(),
		};

		handler = new VerifyEmailHandler(
			mockUserReadRepository as any,
			mockUserWriteRepository as any,
			mockDtoService as any,
			mockAuthSessionService as any,
		);
	});

	it("should throw when token is invalid", async () => {
		const command = new VerifyEmailCommand("user@example.com", "12345");
		mockUserReadRepository.findByEmailVerificationToken.resolves(null);

		await expect(handler.execute(command)).to.be.rejectedWith("Invalid or expired verification token");
	});

	it("should return user when already verified", async () => {
		const command = new VerifyEmailCommand("user@example.com", "12345");
		const user = {
			_id: { toString: () => "1" },
			id: "1",
			isAdmin: false,
			isEmailVerified: true,
		};
		const dto = { publicId: "p1", email: "user@example.com", isEmailVerified: true };
		mockUserReadRepository.findByEmailVerificationToken.resolves(user);
		mockDtoService.toAuthenticatedUserDTO.returns(dto);

		const result = await handler.execute(command);

		expect(result).to.equal(dto);
		expect(mockUserWriteRepository.update.called).to.equal(false);
		expect(mockAuthSessionService.markUserEmailVerified.called).to.equal(false);
	});

	it("should verify and return updated user", async () => {
		const command = new VerifyEmailCommand("user@example.com", "12345");
		const user = {
			_id: { toString: () => "1" },
			id: "1",
			isAdmin: false,
			isEmailVerified: false,
		};
		const updatedUser = {
			_id: { toString: () => "1" },
			id: "1",
			publicId: "p1",
			isAdmin: false,
			isEmailVerified: true,
		};
		const dto = { publicId: "p1", email: "user@example.com", isEmailVerified: true };

		mockUserReadRepository.findByEmailVerificationToken.resolves(user);
		mockUserWriteRepository.update.resolves(updatedUser);
		mockDtoService.toAuthenticatedUserDTO.returns(dto);

		const result = await handler.execute(command);

		expect(result).to.equal(dto);
		expect(mockUserWriteRepository.update.calledOnce).to.equal(true);
		expect(mockAuthSessionService.markUserEmailVerified.calledOnceWith("p1")).to.equal(true);
	});
});
