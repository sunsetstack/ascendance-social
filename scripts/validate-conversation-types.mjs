import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scopes = [
  [
    "backend",
    "backend/tsconfig.json",
    [
      "backend/src/controllers/messaging.controller.ts",
      "backend/src/routes/messaging.routes.ts",
      "backend/src/application/commands/messaging/manageConversation/manageConversation.handler.ts",
      "backend/src/application/events/message/conversations-changed.handler.ts",
      "backend/src/application/events/message/message-sent.handler.ts",
      "backend/src/application/handlers/realtime/ConversationsChangedHandler.ts",
      "backend/src/application/queries/notification/getNotifications/getNotifications.handler.ts",
      "backend/src/application/commands/admin/logRequest/logRequest.handler.ts",
      "backend/src/services/redis.service.ts",
    ],
  ],
  [
    "backend-tests",
    "backend/tsconfig.test.json",
    [
      "backend/src/__tests__/integration/conversation-lifecycle.integration.test.ts",
      "backend/src/__tests__/integration/send-message-transaction.integration.test.ts",
      "backend/src/__tests__/commands/messaging/sendMessage.handler.test.ts",
      "backend/src/__tests__/commands/messaging/conversation-observability.test.ts",
      "backend/src/__tests__/commands/messaging/deleteMessage.handler.test.ts",
      "backend/src/__tests__/queries/messaging/getConversationMessages.handler.test.ts",
      "backend/src/__tests__/routes/messaging.routes.test.ts",
      "backend/src/__tests__/events/stale-account-events.test.ts",
      "backend/src/__tests__/queries/notification/getNotifications.handler.test.ts",
      "backend/src/__tests__/services/redis-notification.module.test.ts",
    ],
  ],
  [
    "frontend",
    "frontend/tsconfig.app.json",
    [
      "frontend/src/screens/Messages.tsx",
      "frontend/src/components/messages/MessagesConversationList.tsx",
      "frontend/src/components/messages/ConversationActions.tsx",
      "frontend/src/hooks/messaging/useMessagingSocketIntegration.ts",
      "frontend/src/hooks/messaging/useManageConversation.ts",
    ],
  ],
  [
    "browser-tests",
    "frontend/tsconfig.app.json",
    [
      "frontend/cypress/fixtures/conversation-controls.tsx",
      "frontend/cypress/regression/conversation-controls.cy.ts",
    ],
  ],
];
const formatHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n",
};
let errors = 0;
console.log(`[conversation-types] TypeScript ${ts.version}; selected roots and their dependencies; no emit`);
for (const [name, config, files] of scopes) {
  const configPath = path.join(root, config);
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error)
    throw new Error(ts.formatDiagnostics([loaded.error], formatHost));
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
  );
  const options = {
    ...parsed.options,
    noEmit: true,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
  };
  if (name === "browser-tests") {
    options.types = ["node"];
    options.rootDir = undefined;
  }
  const ambient = parsed.fileNames.filter((file) => file.endsWith(".d.ts"));
  if (name === "browser-tests")
    ambient.push(
      path.join(root, "frontend/node_modules/cypress/types/index.d.ts"),
    );
  if (name.startsWith("backend"))
    ambient.push(
      path.join(
        root,
        "backend/src/middleware/request-logging/completed-request-context.ts",
      ),
    );
  const program = ts.createProgram(
    [...files.map((file) => path.join(root, file)), ...ambient],
    options,
  );
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  console.log(
    `[conversation-types] ${name}: ${files.length} explicit entrypoints; ${diagnostics.length} diagnostics including imported dependencies`,
  );
  if (diagnostics.length)
    console.log(ts.formatDiagnostics(diagnostics, formatHost));
  errors += diagnostics.length;
}
process.exitCode = errors ? 1 : 0;
