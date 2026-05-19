describe("Like a random photo via modal", () => {
  beforeEach(() => {
    cy.readFile("cypress/fixtures/cookies.json").then((cookies) => {
      cookies.forEach((cookie) => {
        cy.setCookie(cookie.name, cookie.value);
      });
    });
    cy.visit("http://localhost:5173"); 
   
  });

  it("should scroll, open an image modal, like the image, close the modal", () => {
    cy.wait(1000); // Wait for images to load

    // Scroll down a bit
    cy.scrollTo("bottom", { duration: 1000 });
    cy.wait(500); 

    // Get all images and select one at random
    cy.get("img")
      .its("length")
      .then((count) => {
        if (count === 0) {
          throw new Error("No images found");
        }
        const randomIndex = Math.floor(Math.random() * count);
        cy.get("img").eq(randomIndex).click(); // Click a random image
      });

    cy.get("[role=dialog]").should("be.visible"); // Check if modal is visible

    cy.get("button").contains("Like").click(); 

    cy.wait(500);
    
    cy.get(".MuiBackdrop-root").click({ force: true }); // Close modal

    cy.wait(500);
    cy.get("[role=dialog]").should("not.exist"); // Check if it's closed
  });
});
