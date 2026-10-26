import { expect } from "chai";
import express from "express";
import * as fs from "fs";
import { describe, it } from "mocha";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import request from "supertest";
import sinon from "sinon";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { LocalStorageService } from "@/services/localStorage.service";
import { AppError, ErrorHandler, Errors } from "@/utils/errors";
import { errorLogger, logger } from "@/utils/winston";

const VALID_USER_ID = "123e4567-e89b-42d3-a456-426614174000";

function buildErrorApp(operation: () => Promise<void>): express.Express {
  const app = express();
  app.get("/failure", async (_req, res, next) => {
    try {
      await operation();
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });
  app.use(ErrorHandler.handleError);
  return app;
}

function createFeedReadService(getWithTags: () => Promise<unknown>): FeedReadService {
  return new FeedReadService(
    {} as never,
    { getWithTags } as never,
    {} as never,
    {} as never,
  );
}

describe("HTTP error log ownership", () => {
  it("lets ErrorHandler own a local-storage infrastructure failure", async () => {
    const sandbox = sinon.createSandbox();
    const original = new Error("disk write failed");
    const temporaryUploadsDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "ascendance-storage-test-"),
    );

    try {
      const localError = sandbox.stub(logger, "error");
      const terminalError = sandbox.stub(errorLogger, "error");
      const storage = new LocalStorageService();
      (storage as unknown as { uploadsDir: string }).uploadsDir =
        temporaryUploadsDir;
      const source = new Readable({
        read(): void {
          this.destroy(original);
        },
      });
      const response = await request(
        buildErrorApp(async () => {
          await storage.uploadImageStream(
            { stream: source },
            VALID_USER_ID,
          );
        }),
      )
        .get("/failure")
        .expect(500);

      expect(response.body.error.type).to.equal("StorageError");
      expect(localError.notCalled).to.equal(true);
      expect(terminalError.calledOnce).to.equal(true);
      const terminalRecord = terminalError.firstCall.args[0] as {
        error?: { cause?: { message?: string } };
      };
      expect(terminalRecord.error?.cause?.message).to.equal(original.message);
    } finally {
      sandbox.restore();
      await fs.promises.rm(temporaryUploadsDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it("lets ErrorHandler own a feed-read infrastructure failure", async () => {
    const sandbox = sinon.createSandbox();
    const original = new Error("Redis unavailable");
    const localError = sandbox.stub(logger, "error");
    const terminalError = sandbox.stub(errorLogger, "error");
    const feedReadService = createFeedReadService(async () => {
      throw original;
    });

    try {
      const response = await request(
        buildErrorApp(async () => {
          await feedReadService.getNewFeed(1, 20);
        }),
      )
        .get("/failure")
        .expect(500);

      expect(response.body.error.type).to.equal("InternalServerError");
      expect(localError.notCalled).to.equal(true);
      expect(terminalError.calledOnce).to.equal(true);
      const terminalRecord = terminalError.firstCall.args[0] as {
        error?: { message?: string };
      };
      expect(terminalRecord.error?.message).to.equal(original.message);
    } finally {
      sandbox.restore();
    }
  });

  it("preserves a feed-read domain AppError unchanged", async () => {
    const domainError = Errors.validation("Invalid feed filter");
    const feedReadService = createFeedReadService(async () => {
      throw domainError;
    });

    let caught: unknown;
    try {
      await feedReadService.getNewFeed(1, 20);
    } catch (error) {
      caught = error;
    }

    expect(caught).to.equal(domainError);
    expect((caught as AppError).statusCode).to.equal(400);
  });

  it("retains the legacy deletion warning as a recovered local path", async () => {
    const sandbox = sinon.createSandbox();

    try {
      const localWarning = sandbox.stub(logger, "warn");
      const terminalError = sandbox.stub(errorLogger, "error");
      const storage = new LocalStorageService();
      const storageWithLegacyDelete = storage as unknown as {
        deleteLegacyImage(filename: string): Promise<void>;
      };
      sandbox.stub(storageWithLegacyDelete, "deleteLegacyImage").resolves();

      await storage.deleteImage("legacy-file");

      expect(localWarning.calledOnce).to.equal(true);
      expect(terminalError.notCalled).to.equal(true);
    } finally {
      sandbox.restore();
    }
  });
});
