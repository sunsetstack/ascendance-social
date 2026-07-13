describe("Anonymous public access", () => {
  const emptyPage = {
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  };

  beforeEach(() => {
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.intercept("GET", "/api/users/me", {
      statusCode: 401,
      body: { message: "Authentication required" },
    }).as("currentUser");
    cy.intercept("POST", "/api/users/refresh", {
      statusCode: 401,
      body: { message: "Authentication required" },
    });
		cy.intercept({ method: "GET", pathname: "/api/feed/new" }, emptyPage);
		cy.intercept({ method: "GET", pathname: "/api/feed/trending" }, emptyPage);
    cy.intercept("GET", "/api/communities?*", emptyPage);
  });

  it("shows public desktop navigation without private actions", () => {
    cy.viewport(1280, 720);
    cy.visit("/discover?feed=latest");
    cy.wait("@currentUser");

    cy.get('[data-testid="left-sidebar"]').within(() => {
      cy.get('a[href="/"]').should("be.visible");
      cy.get('a[href="/discover"]').should("be.visible");
      cy.get('a[href="/communities"]').should("be.visible");
      cy.get('a[href="/notifications"]').should("not.exist");
      cy.get('a[href="/messages"]').should("not.exist");
    });
  });

  it("shows public mobile navigation and hides creation controls", () => {
    cy.viewport(375, 667);
    cy.visit("/discover?feed=latest");
    cy.wait("@currentUser");

    cy.get('[data-testid="bottom-navigation"]')
      .should("be.visible")
      .within(() => {
        cy.get('a[href="/"]').should("be.visible");
        cy.get('a[href="/discover"]').should("be.visible");
        cy.get('a[href="/communities"]').should("be.visible");
        cy.get('a[href="/login"]').should("be.visible");
        cy.get('a[href="/notifications"]').should("not.exist");
        cy.get('a[href="/messages"]').should("not.exist");
      });

    cy.get('button[aria-label="Create new post"]').should("not.exist");
    cy.get('button[aria-label="Open navigation menu"]').click();
    cy.get('[data-testid="mobile-drawer"]')
      .should("be.visible")
      .within(() => {
        cy.contains("Home").should("be.visible");
        cy.contains("Explore").should("be.visible");
        cy.contains("Communities").should("be.visible");
      });
  });

  it("normalizes a protected personalized feed without requesting it", () => {
    let personalizedRequests = 0;
    cy.intercept("GET", "/api/feed/for-you*", (request) => {
      personalizedRequests += 1;
      request.reply(emptyPage);
    });

    cy.viewport(375, 667);
    cy.visit("/discover?feed=foryou");
    cy.wait("@currentUser");

    cy.location("search").should("eq", "?feed=latest");
    cy.contains("Latest").should("be.visible");
    cy.then(() => {
      expect(personalizedRequests).to.equal(0);
    });
  });

  it("opens public community discovery without requesting memberships", () => {
    let membershipRequests = 0;
    cy.intercept("GET", "/api/communities/me*", (request) => {
      membershipRequests += 1;
      request.reply(emptyPage);
    });

    cy.viewport(375, 667);
    cy.visit("/communities");
    cy.wait("@currentUser");

    cy.contains('[role="tab"]', "Find Communities").should("be.visible");
    cy.contains('[role="tab"]', "My Communities").should("not.exist");
    cy.then(() => {
      expect(membershipRequests).to.equal(0);
    });
  });
});
