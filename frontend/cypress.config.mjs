import { defineConfig } from "cypress";
import { MongoClient } from "mongodb";

const localMongoUri =
  process.env.CYPRESS_MONGODB_URI ??
  "mongodb://ascendance:dev-app-password@127.0.0.1:27017/PhotoAppOOP?authSource=PhotoAppOOP&replicaSet=rs0&directConnection=true";

async function withLocalDatabase(run) {
  const client = new MongoClient(localMongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    return await run(client.db("PhotoAppOOP"));
  } finally {
    await client.close();
  }
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173/",
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    supportFile: "cypress/support/e2e.ts",
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    pageLoadTimeout: 30000,
    retries: {
      runMode: 0,
      openMode: 0,
    },
    setupNodeEvents(on) {
      on("task", {
        getEmailVerificationToken(email) {
          return withLocalDatabase(async (database) => {
            const user = await database.collection("users").findOne(
              { email: String(email).trim().toLowerCase() },
              { projection: { emailVerificationToken: 1 } },
            );
            const token = user?.emailVerificationToken;
            if (typeof token !== "string") {
              throw new Error(`No verification token found for ${email}`);
            }
            return token;
          });
        },
        getAccountDeletionAudit(publicId) {
          return withLocalDatabase(async (database) => {
            const event = await database
              .collection("securityAuditEvents")
              .findOne({
                eventType: "account.delete.evidence.completed",
                "target.id": String(publicId),
              });
            if (!event) return null;
            return {
              eventType: event.eventType,
              targetId: event.target?.id,
              reason: event.reason,
              snapshotId: event.metadata?.snapshotId,
              sourceCounts: event.metadata?.sourceCounts,
            };
          });
        },
      });
    },
  },
});
