describe("Guest home", () => {
	beforeEach(() => {
		cy.clearCookies();
		cy.clearLocalStorage();
		cy.visit("/");
	});

	it("renders the translated guest call to action", () => {
		cy.contains("Discover what moves people").should("be.visible");
		cy.contains("New to Ascendance?").should("be.visible");
		cy.get("body").should("not.contain.text", "marketing.new_to_ascendance");
	});
});
