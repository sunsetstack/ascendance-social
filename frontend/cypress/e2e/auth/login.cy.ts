describe("Login", () => {
	const user = {
		publicId: "22222222-2222-4222-8222-222222222222",
		handle: "login_user",
		username: "LoginUser",
		email: "login-user@example.com",
		avatar: "",
		cover: "",
		bio: "",
		createdAt: "2026-07-14T00:00:00.000Z",
		postCount: 0,
		followerCount: 0,
		followingCount: 0,
		isAdmin: false,
	};

	beforeEach(() => {
		cy.intercept("GET", "/api/users/me", {
			statusCode: 401,
			body: { message: "Authentication required" },
		});
		cy.intercept("POST", "/api/users/refresh", {
			statusCode: 401,
			body: { message: "Authentication required" },
		});
	});

	function submitLogin(): void {
		cy.visit("/login");
		cy.get('input[name="email"]').type(user.email);
		cy.get('input[name="password"]').type("password123");
		cy.contains('button[type="submit"]', "Sign In").click();
	}

	it("routes a verified user home and exposes their handle-based profile link", () => {
		cy.intercept("POST", "/api/users/login", {
			statusCode: 200,
			body: { user: { ...user, isEmailVerified: true } },
		}).as("login");

		submitLogin();
		cy.wait("@login").its("request.body").should("deep.equal", {
			email: user.email,
			password: "password123",
		});
		cy.location("pathname", { timeout: 5000 }).should("eq", "/");
		cy.get('[data-testid="left-sidebar"]')
			.find(`a[href="/profile/${user.handle}"]`)
			.should("be.visible");
	});

	it("routes an unverified user to email verification", () => {
		cy.intercept("POST", "/api/users/login", {
			statusCode: 200,
			body: { user: { ...user, isEmailVerified: false } },
		}).as("login");

		submitLogin();
		cy.wait("@login");
		cy.location("pathname", { timeout: 5000 }).should("eq", "/verify-email");
		cy.location("search").should("eq", `?email=${encodeURIComponent(user.email)}`);
		cy.contains("Verify your email").should("be.visible");
	});
});
