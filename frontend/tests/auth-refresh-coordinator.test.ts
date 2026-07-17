import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthRefreshCoordinator,
  shouldAttemptAuthRefresh,
  type RetryableAuthRequest,
} from "../src/api/authRefreshCoordinator.ts";

test("coalesces many simultaneous 401 responses into one refresh and one retry each", async () => {
  const coordinator = new AuthRefreshCoordinator();
  const requests: RetryableAuthRequest[] = Array.from(
    { length: 25 },
    () => ({}),
  );
  let refreshCalls = 0;
  let retryCalls = 0;

  const refresh = async (): Promise<void> => {
    refreshCalls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  await Promise.all(
    requests.map(async (request) => {
      assert.equal(shouldAttemptAuthRefresh(401, request, false), true);
      request._retry = true;
      await coordinator.waitForRefresh(refresh);
      retryCalls += 1;
      assert.equal(shouldAttemptAuthRefresh(401, request, false), false);
    }),
  );

  assert.equal(refreshCalls, 1);
  assert.equal(retryCalls, requests.length);
  assert.equal(requests.every((request) => request._retry === true), true);
});

test("shares a failed refresh and permits a later independent refresh attempt", async () => {
  const coordinator = new AuthRefreshCoordinator();
  const expectedError = new Error("refresh failed");
  let refreshCalls = 0;
  const failedRefresh = async (): Promise<void> => {
    refreshCalls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    throw expectedError;
  };

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      coordinator.waitForRefresh(failedRefresh),
    ),
  );

  assert.equal(refreshCalls, 1);
  assert.equal(results.every((result) => result.status === "rejected"), true);

  await coordinator.waitForRefresh(async () => {
    refreshCalls += 1;
  });
  assert.equal(refreshCalls, 2);
});

test("resets after a successful refresh and permits a later refresh cycle", async () => {
  const coordinator = new AuthRefreshCoordinator();
  let refreshCalls = 0;
  const refresh = async (): Promise<void> => {
    refreshCalls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  await Promise.all([
    coordinator.waitForRefresh(refresh),
    coordinator.waitForRefresh(refresh),
  ]);
  assert.equal(refreshCalls, 1);

  await coordinator.waitForRefresh(refresh);
  assert.equal(refreshCalls, 2);
});

test("does not refresh bypass endpoints, non-401 responses, or retried requests", () => {
  assert.equal(shouldAttemptAuthRefresh(403, {}, false), false);
  assert.equal(shouldAttemptAuthRefresh(401, undefined, false), false);
  assert.equal(shouldAttemptAuthRefresh(401, {}, true), false);
  assert.equal(shouldAttemptAuthRefresh(401, { _retry: true }, false), false);
});
