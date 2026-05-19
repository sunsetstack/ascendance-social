describe('User Registration', () => {
  beforeEach(() => {
    cy.visit('/register'); 
  });

  it('should allow a new user to sign up', () => {
    cy.fixture('user.json').then((user) => {
      cy.get('input[name="email"]').type(user.email);
      cy.get('input[name="username"]').type(user.username);
      cy.get('input[name="password"]').type(user.password);
      cy.get('button[type="submit"]').click();

      cy.url().should('eq', 'http://localhost:5173/login');
    });
  });
});
