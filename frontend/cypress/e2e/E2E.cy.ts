interface AccountDeletionAudit {
	eventType: string;
	targetId: string;
	reason: string;
	snapshotId: string;
	sourceCounts: Record<string, number>;
}

describe("Authenticated account lifecycle", () => {
	let cleanupEmail = "";
	let cleanupPassword = "";
	let origin = "";

	afterEach(() => {
		if (!cleanupEmail || !cleanupPassword || !origin) return;
		cy.request({
			method: "POST",
			url: "/api/users/login",
			headers: { Origin: origin },
			body: { email: cleanupEmail, password: cleanupPassword },
			failOnStatusCode: false,
		}).then((loginResponse) => {
			if (loginResponse.status !== 200) return;
			cy.request({
				method: "DELETE",
				url: "/api/users/me",
				headers: { Origin: origin },
				body: {
					password: cleanupPassword,
					reason: "Cypress E2E failure-safe cleanup",
				},
				timeout: 60000,
			});
		});
	});

	it("registers, verifies, signs in, creates a post, and deletes the account with audit evidence", () => {
		const suffix = Date.now().toString().slice(-10);
		const user = {
			handle: `e2e${suffix}`,
			username: `E2E${suffix}`,
			email: `e2e-${suffix}@example.com`,
			password: "password123",
		};
		const postBody = `Cypress lifecycle post ${suffix}`;
		const deletionReason = "Cypress E2E account lifecycle cleanup";
		origin = new URL(Cypress.config("baseUrl") as string).origin;
		cleanupEmail = user.email;
		cleanupPassword = user.password;
		let publicId = "";

		cy.request({
			method: "POST",
			url: "/api/users/register",
			body: {
				...user,
				confirmPassword: user.password,
			},
		}).then((response) => {
			expect(response.status).to.equal(201);
			expect(response.body.user).to.include({
				handle: user.handle,
				username: user.username,
				email: user.email,
				isEmailVerified: false,
			});
			expect(response.body.user.publicId).to.match(/^[0-9a-f-]{36}$/);
			publicId = response.body.user.publicId;

			return cy.task("getEmailVerificationToken", user.email);
		}).then((token) => {
			expect(token).to.match(/^\d{5}$/);
			return cy.request({
				method: "POST",
				url: "/api/users/verify-email",
				headers: { Origin: origin },
				body: { email: user.email, token },
			});
		}).then((response) => {
			expect(response.status).to.equal(200);
			expect(response.body.isEmailVerified).to.equal(true);
		});

		cy.clearCookies();
		cy.intercept("POST", "/api/users/login").as("login");
		cy.visit("/login");
		cy.get('input[name="email"]').type(user.email);
		cy.get('input[name="password"]').type(user.password);
		cy.contains('button[type="submit"]', "Sign In").click();
		cy.wait("@login").its("response.statusCode").should("eq", 200);
		cy.location("pathname", { timeout: 10000 }).should("eq", "/");

		cy.get('[data-testid="left-sidebar"]')
			.should("be.visible")
			.within(() => {
				cy.get(`a[href="/profile/${user.handle}"]`).should("be.visible");
				cy.get('[data-testid="post-button"]').should("be.visible").click();
			});

		cy.intercept("POST", "/api/posts").as("createPost");
		cy.get('[aria-labelledby="create-post-modal"]')
			.should("be.visible")
			.within(() => {
				cy.get("textarea").filter(":visible").first().type(postBody);
				cy.contains("button", /^Post$/).should("be.enabled").click();
			});
		cy.wait("@createPost").its("response.statusCode").should("eq", 201);
		cy.get('[aria-labelledby="create-post-modal"]').should("not.exist");

		cy.get('[data-testid="left-sidebar"]')
			.find(`a[href="/profile/${user.handle}"]`)
			.filter(":visible")
			.first()
			.click();
		cy.location("pathname").should("eq", `/profile/${user.handle}`);
		cy.contains(postBody, { timeout: 15000 }).should("be.visible");

		cy.request({
			method: "DELETE",
			url: "/api/users/me",
			headers: { Origin: origin },
			body: { password: user.password, reason: deletionReason },
			timeout: 60000,
		}).its("status").should("eq", 200);

		cy.request({
			method: "GET",
			url: "/api/users/me",
			failOnStatusCode: false,
		}).its("status").should("eq", 401);
		cy.then(() => {
			return cy.request({
				method: "GET",
				url: `/api/users/public/${publicId}`,
				failOnStatusCode: false,
			});
		}).its("status").should("eq", 404);

		cy.then(() => cy.task<AccountDeletionAudit>("getAccountDeletionAudit", publicId)).then((audit) => {
			expect(audit).to.include({
				eventType: "account.delete.evidence.completed",
				targetId: publicId,
				reason: deletionReason,
			});
			expect(audit.snapshotId).to.match(/^[0-9a-f-]{36}$/);
			expect(audit.sourceCounts).to.include({ profile: 1, posts: 1 });
		});
	});
});
