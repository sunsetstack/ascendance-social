describe("Registration", () => {
	const user = {
		publicId: "11111111-1111-4111-8111-111111111111",
		handle: "new_user",
		username: "NewUser",
		email: "new-user@example.com",
		password: "password123",
		avatar: "",
		cover: "",
		bio: "",
		createdAt: "2026-07-14T00:00:00.000Z",
		postCount: 0,
		followerCount: 0,
		followingCount: 0,
		isEmailVerified: false,
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

	it("submits the complete contract and verifies the email code", () => {
		cy.intercept("POST", "/api/users/register", {
			statusCode: 201,
			body: { user },
		}).as("register");
		cy.intercept("POST", "/api/users/verify-email", {
			statusCode: 200,
			body: { ...user, isEmailVerified: true },
		}).as("verifyEmail");

		cy.visit("/register");
		cy.get('input[name="handle"]').type(user.handle);
		cy.get('input[name="username"]').type(user.username);
		cy.get('input[name="email"]').type(user.email);
		cy.get('input[name="password"]').type(user.password);
		cy.get('input[name="confirmPassword"]').type(user.password);
		cy.contains('button[type="submit"]', "Sign Up").click();

		cy.wait("@register").its("request.body").should("deep.include", {
			handle: user.handle,
			username: user.username,
			email: user.email,
			password: user.password,
			confirmPassword: user.password,
		});
		cy.location("pathname").should("eq", "/verify-email");
		cy.contains("Verify your email").should("be.visible");
		cy.get('input[inputmode="numeric"]').type("12345");
		cy.contains('button[type="submit"]', "Verify email").click();
		cy.wait("@verifyEmail").its("request.body").should("deep.equal", {
			email: user.email,
			token: "12345",
		});
		cy.contains("Your email is verified").should("be.visible");
	});
});
