describe("Profile Button Test", () => {
	const timestamp = Date.now();
	const user = {
		username: `testuser${timestamp}`,
		email: `testuser${timestamp}@test.com`,
		password: "password123",
	};

	it("should navigate to correct profile URL after login", () => {
		// Register a new user
		cy.visit("/register");
		cy.get('input[name="username"]').type(user.username);
		cy.get('input[name="email"]').type(user.email);
		cy.get('input[name="password"]').type(user.password);
		cy.get('input[name="confirmPassword"]').type(user.password);
		cy.get('button[type="submit"]').click();

		// Login
		cy.url().should("include", "/login");
		cy.get('input[name="email"]').type(user.email);
		cy.get('input[name="password"]').type(user.password);
		cy.get('button[type="submit"]').click();

		// Should be on home page
		cy.url().should("not.include", "/login");

		// Wait for authentication to complete
		cy.wait(2000);

		// Click on Profile button in left sidebar
		cy.get('[data-testid="left-sidebar"]').within(() => {
			cy.contains("Profile").click();
		});

		// Should navigate to a profile URL with publicId, not just /profile
		cy.url().should("include", "/profile/");
		cy.url().should("not.eq", "http://localhost:5173/profile");

		// Verify it's not the generic /profile route
		cy.url().then((url: string) => {
			const pathParts = url.split("/profile/");
			expect(pathParts).to.have.length(2);
			expect(pathParts[1]).to.not.equal("");
			expect(pathParts[1]).to.match(/^[a-f0-9-]+/); // Should be a UUID-like string
		});
		
		// Verify user profile content loads
		cy.contains(user.username).should("be.visible");
	});
});
