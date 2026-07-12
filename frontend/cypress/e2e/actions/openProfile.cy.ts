describe("Open profile page", () => {
  beforeEach(() => {
    cy.readFile("cypress/fixtures/cookies.json").then((cookies) => {
      cookies.forEach((cookie: Cypress.Cookie) => {
        cy.setCookie(cookie.name, cookie.value);
      });
    });
    cy.visit("http://localhost:5173"); 
   
  });

  it("should scroll, open an image modal, like the image, close the modal", () => {
    cy.wait(1000);

    cy.get(".MuiAvatar-root").click();
    cy.wait(400);

    cy.contains('Upload').click();
    cy.wait(400);

    cy.get("#upload-modal-title").should("be.visible"); 

    cy.get("[for=dropzone-file]").click()

    cy.wait(500);


  })

})
