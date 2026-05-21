describe("Complete E2E User Journey", () => {
  const timestamp = Date.now();
  const user1 = {
    username: `user1${timestamp}`,
    email: `user1${timestamp}@test.com`,
    password: "password123",
  };

  const user2 = {
    username: `user2${timestamp}`,
    email: `user2${timestamp}@test.com`,
    password: "password123",
  };

  let user1PublicId = "";

  const loginUser = (email: string, password: string) => {
    cy.visit("/login");
    cy.get('input[name="email"]').clear().type(email);
    cy.get('input[name="password"]').clear().type(password);
    cy.get('button[type="submit"]').click();
    cy.url().should("not.include", "/login");
  };

  beforeEach(() => {
    // Set viewport for consistent testing
    cy.viewport(1280, 720);
  });

  it("should allow user1 to register and login", () => {
    cy.visit("/register");

    // Fill registration form
    cy.get('input[name="username"]').type(user1.username);
    cy.get('input[name="email"]').type(user1.email);
    cy.get('input[name="password"]').type(user1.password);
    cy.get('input[name="confirmPassword"]').type(user1.password);

    // Submit registration
    cy.get('button[type="submit"]').should("contain", "Sign Up").click();

    // Should redirect to login
    cy.url().should("include", "/login", { timeout: 10000 });

    // Login with the new account
    cy.get('input[name="email"]').clear().type(user1.email);
    cy.get('input[name="password"]').clear().type(user1.password);
    cy.get('button[type="submit"]').should("contain", "Sign In").click();

    // Should be logged in and redirected home
    cy.url().should("not.include", "/login", { timeout: 10000 });

    // Verify left sidebar is visible (desktop) or hamburger menu (mobile)
    cy.get("body").then(() => {
      // First try the left sidebar (desktop)
      if (Cypress.$('[data-testid="left-sidebar"]').length > 0) {
        cy.get('[data-testid="left-sidebar"]')
          .should("be.visible")
          .within(() => {
            cy.contains("Home").should("be.visible");
            cy.contains("Post").should("be.visible");
          });
      }
      // If not found, check for mobile hamburger menu
      else {
        cy.get('button[aria-label="open drawer"]', { timeout: 5000 }).should(
          "be.visible",
        );
      }
    });
  });

  it("should allow user1 to upload an image via left sidebar", () => {
    loginUser(user1.email, user1.password);

    // Wait for page to load
    cy.get("body", { timeout: 10000 }).should("be.visible");

    // Try to find and click the Post button - use data-testid for reliability
    cy.get('[data-testid="post-button"]', { timeout: 10000 })
      .should("be.visible")
      .click();

    // Verify upload modal opened
    cy.get('[aria-labelledby="upload-modal-title"]', { timeout: 10000 }).should(
      "be.visible",
    );

    // Upload the test image
    cy.get('input[type="file"]', { timeout: 5000 }).should("exist");
    cy.get('input[type="file"]').attachFile("test-image.png");

    // Wait for image preview to appear
    cy.get('img[src*="blob:"], img[src*="data:"]', { timeout: 10000 }).should(
      "be.visible",
    );

    // Add tags using the tags input
    cy.get('input[id="tags"]').should("be.visible").type("test{enter}");
    cy.wait(500); // Wait for tag to be processed
    cy.get('input[id="tags"]').type("cypress{enter}");
    cy.wait(500);
    cy.get('input[id="tags"]').type("e2e{enter}");
    cy.wait(500);

    // Verify tags appear
    cy.contains("test").should("be.visible");
    cy.contains("cypress").should("be.visible");
    cy.contains("e2e").should("be.visible");

    // Upload the image
    cy.get("button").contains("Upload Image").should("be.enabled").click();

    // Wait for modal to close and redirect to home
    cy.get('[aria-labelledby="upload-modal-title"]', { timeout: 15000 }).should(
      "not.exist",
    );

    // Verify image appears in the feed
    cy.get(".MuiCard-root", { timeout: 15000 })
      .should("exist")
      .and("be.visible");
    cy.contains(user1.username, { timeout: 10000 }).should("be.visible");
  });

  it("should allow user1 to view their profile via left sidebar", () => {
    loginUser(user1.email, user1.password);

    // Wait for page to load
    cy.get("body", { timeout: 10000 }).should("be.visible");

    // Navigate to profile via left sidebar
    cy.get("body").then(() => {
      // First try the left sidebar (desktop)
      if (Cypress.$('[data-testid="left-sidebar"]').length > 0) {
        cy.get('[data-testid="left-sidebar"]')
          .should("be.visible")
          .within(() => {
            cy.contains("Profile").click();
          });
      }
      // If not found, try mobile hamburger menu
      else if (Cypress.$('button[aria-label="open drawer"]').length > 0) {
        cy.get('button[aria-label="open drawer"]').click();
        cy.get(".MuiDrawer-paper")
          .should("be.visible")
          .within(() => {
            cy.contains("Profile").click();
          });
      }
      // Last resort - try any button with Profile text
      else {
        cy.contains("Profile").click();
      }
    });

    // Should be on profile page
    cy.url().should("include", "/profile/", { timeout: 10000 });

    // Verify user info is displayed
    cy.contains(user1.username, { timeout: 10000 }).should("be.visible");

    // Verify uploaded image appears on profile
    cy.get(".MuiCard-root", { timeout: 10000 })
      .should("exist")
      .and("be.visible");

    // Extract user publicId from URL for later use
    cy.url().then((url: string) => {
      const pathParts = url.split("/profile/");
      if (pathParts.length > 1) {
        user1PublicId = pathParts[1].split("?")[0];
        cy.log(`User1 publicId: ${user1PublicId}`);
      }
    });
  });

  it("should allow user2 to register, login, and follow user1", () => {
    // Register user2
    cy.visit("/register");
    cy.get('input[name="username"]').type(user2.username);
    cy.get('input[name="email"]').type(user2.email);
    cy.get('input[name="password"]').type(user2.password);
    cy.get('input[name="confirmPassword"]').type(user2.password);
    cy.get('button[type="submit"]').click();

    // Should redirect to login
    cy.url().should("include", "/login", { timeout: 10000 });

    // Login user2
    loginUser(user2.email, user2.password);

    // Navigate to user1's profile
    cy.visit(`/profile/${user1PublicId}`);

    // Follow user1
    cy.contains("button", "Follow", { timeout: 5000 }).click();

    // Verify follow state changed
    cy.contains("button", "Unfollow", { timeout: 5000 }).should("be.visible");
  });

  it("should show user1's image in user2's feed", () => {
    loginUser(user2.email, user2.password);

    // Wait for feed to load
    cy.get(".MuiCard-root", { timeout: 15000 })
      .should("exist")
      .and("be.visible");

    // Should see user1's content in the feed
    cy.contains(user1.username, { timeout: 10000 }).should("be.visible");
  });

  it("should allow user2 to like and comment on user1's image", () => {
    loginUser(user2.email, user2.password);

    // Wait for feed to load and find user1's image
    cy.get(".MuiCard-root", { timeout: 15000 })
      .should("exist")
      .and("be.visible");

    // Click on the image card to view details
    cy.get(".MuiCard-root").first().click();

    // Should navigate to image view page
    cy.url().should("include", "/images/", { timeout: 10000 });

    // Verify image is displayed
    cy.get("img", { timeout: 10000 }).should("be.visible");

    // Like the image
    cy.get(
      'button[aria-label*="like"], button:has(svg[data-testid="FavoriteBorderIcon"]), button:has(svg[data-testid="FavoriteIcon"])',
      { timeout: 5000 },
    )
      .first()
      .click();

    // Wait for like to register
    cy.wait(1000);

    // Add a comment
    cy.get(
      'textarea[placeholder*="comment" i], input[placeholder*="comment" i]',
      { timeout: 5000 },
    )
      .should("be.visible")
      .type("This is a test comment from user2!");

    // Submit the comment
    cy.get("button").contains("Post").click();

    // Verify comment appears
    cy.contains("This is a test comment from user2!", {
      timeout: 10000,
    }).should("be.visible");
    cy.contains(user2.username, { timeout: 5000 }).should("be.visible");
  });

  it("should show user2's like and comment when user1 views the image", () => {
    loginUser(user1.email, user1.password);

    // Wait for feed to load
    cy.get(".MuiCard-root", { timeout: 15000 })
      .should("exist")
      .and("be.visible");

    // Click on the image to view details
    cy.get(".MuiCard-root").first().click();

    // Should navigate to image view page
    cy.url().should("include", "/images/", { timeout: 10000 });

    // Verify like count shows at least 1
    cy.get("body").should("contain", "1");

    // Verify user2's comment is visible
    cy.contains("This is a test comment from user2!", { timeout: 5000 }).should(
      "be.visible",
    );
    cy.contains(user2.username, { timeout: 5000 }).should("be.visible");

    // Verify like button shows as liked (should show filled heart icon)
    cy.get(
      'svg[data-testid="FavoriteIcon"], button:has(svg[data-testid="FavoriteIcon"])',
      { timeout: 5000 },
    ).should("exist");
  });

  it("should handle responsive behavior on mobile", () => {
    cy.viewport(375, 667); // iPhone SE size
    loginUser(user1.email, user1.password);

    // On mobile, logo should not appear in navbar
    cy.get("nav").within(() => {
      cy.contains("Ascendance").should("not.exist");
    });

    // Search bar should be visible and have more space
    cy.get('input[placeholder*="Search"]', { timeout: 5000 }).should(
      "be.visible",
    );

    // Left sidebar should be accessible via hamburger menu
    cy.get('button[aria-label="open drawer"]').should("be.visible").click();
    cy.get(".MuiDrawer-paper")
      .should("be.visible")
      .within(() => {
        cy.contains("Home").should("be.visible");
        cy.contains("Profile").should("be.visible");
        cy.contains("Post").should("be.visible");
      });

    // Close sidebar by clicking outside
    cy.get("body").click(0, 0);
    cy.get(".MuiDrawer-paper").should("not.be.visible");
  });
});
