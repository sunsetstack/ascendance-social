import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:5178/",
    specPattern: "cypress/regression/conversation-controls.cy.ts",
    supportFile: false,
  },
  viewportWidth: 1280,
  viewportHeight: 800,
  video: false,
});
