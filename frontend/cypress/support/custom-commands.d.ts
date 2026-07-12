export {};

declare global {
	namespace Cypress {
		interface Chainable<Subject> {
			login(email: string, password: string): Chainable<Subject>;
		}
	}
}
