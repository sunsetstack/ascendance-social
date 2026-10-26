import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { ManageConversationCommand } from "@/application/commands/messaging/manageConversation/manageConversation.command";
import { ManageConversationCommandHandler } from "@/application/commands/messaging/manageConversation/manageConversation.handler";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { LogRequestCommandHandler } from "@/application/commands/admin/logRequest/logRequest.handler";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import { MetricsService } from "@/metrics/metrics.service";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { asConversationPublicId, asUserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";

describe("Conversation observability boundaries", () => {
  afterEach(() => sinon.restore());
  const userId = asUserPublicId("11111111-1111-4111-8111-111111111111");
  const conversationId = asConversationPublicId(
    "33333333-3333-4333-8333-333333333333",
  );

  for (const [outcome, error] of [
    [
      "ambiguous",
      new AmbiguousTransactionCommitError(
        2,
        new Error("Unknown commit result"),
      ),
    ],
    ["rejected", Errors.forbidden("Conversation locked by admin")],
    ["failed", Errors.database("Database unavailable")],
  ] as const) {
    it(`exports ${outcome} independently without claiming a confirmed mutation`, async () => {
      const uow = sinon.createStubInstance(UnitOfWork);
      uow.executeInTransaction.rejects(error);
      const metrics = new MetricsService();
      const log = sinon.stub(logger, "log");
      const handler = new ManageConversationCommandHandler(
        sinon.createStubInstance(ConversationRepository),
        sinon.createStubInstance(UserReadRepository),
        uow,
        sinon.createStubInstance(EventBus),
        metrics,
      );
      const result = await handler
        .execute(
          new ManageConversationCommand(userId, conversationId, "delete"),
        )
        .catch((reason: unknown) => reason);
      expect(result).to.equal(error);
      const exported = await metrics.getMetrics();
      expect(exported).to.match(
        new RegExp(
          `conversation_actions_total\\{[^}]*action="delete"[^}]*outcome="${outcome}"[^}]*\\} 1(?:\\n|$)`,
        ),
      );
      expect(exported).not.to.contain('outcome="succeeded"');
      expect(exported).not.to.contain(conversationId);
      expect(JSON.stringify(log.firstCall.args)).not.to.contain(conversationId);
      expect(JSON.stringify(log.firstCall.args)).not.to.contain(userId);
    });
  }

  it("redacts messaging identifiers before persisting new request logs without mutating the input", async () => {
    const repository = sinon.createStubInstance(RequestLogRepository);
    repository.create.resolves({} as never);
    const payload = {
      method: "DELETE",
      route: `/api/messaging/conversations/${conversationId}/purge`,
      referer: `https://example.test/messages?conversation=${conversationId}`,
      ip: "127.0.0.1",
      statusCode: 204,
      responseTimeMs: 1,
      visitorObservation: {
        schemaVersion: 1 as const,
        path: `/messages?conversation=${conversationId}`,
        referrer: `https://example.test/messages?conversation=${conversationId}`,
      },
    };
    await new LogRequestCommandHandler(repository).execute(
      new LogRequestCommand(payload),
    );
    const persisted = repository.create.firstCall.args[0];
    expect(JSON.stringify(persisted)).not.to.contain(conversationId);
    expect(persisted.metadata!.route).to.equal(
      "/api/messaging/conversations/:redacted/purge",
    );
    expect(payload.route).to.contain(conversationId);
    expect(payload.visitorObservation.path).to.contain(conversationId);
  });
});
