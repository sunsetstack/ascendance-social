describe('User Registration', () => {
  beforeEach(() => {
    cy.visit('/login');     
  });

  it('should allow a new user to sign up', () => {
    cy.fixture('user.json').then((user) => {
      cy.get('input[name="email"]').type(user.email);
      cy.get('input[name="password"]').type(user.password);
      cy.wait(500);
      cy.get('button[type="submit"]').click();
      cy.wait(500);
      cy.getCookies().then((cookies) => {
        console.log("Cookies:", cookies);
      });
      cy.wait(1500);

      cy.url().should('eq', 'http://localhost:5173/');
    });
 
    
  });
  after(() => {
    cy.getCookies().then((cookies) => {
      cy.writeFile("cypress/fixtures/cookies.json", cookies);
    });
  });
});
