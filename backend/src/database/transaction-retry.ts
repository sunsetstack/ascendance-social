import { getErrorCode, getErrorLabels, getErrorMessage } from "@/utils/errors";

const RETRYABLE_ERROR_CODES = new Set([
  112, // WriteConflict
  251, // NoSuchTransaction (transaction expired)
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  189, // PrimarySteppedDown
  91, // ShutdownInProgress
  10107, // NotWritablePrimary
  13435, // NotPrimaryNoSecondaryOk
  13436, // NotPrimaryOrSecondary
  64, // WriteConcernFailed
]);

const RETRYABLE_MESSAGES = [
  "write conflict",
  "writeconflict",
  "transient transaction",
  "please retry",
  "transaction was aborted",
  "transaction number",
  "econnreset",
  "network error",
  "socket exception",
  "connection closed",
  "not primary",
  "node is recovering",
];

export function isRetryableTransactionError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const labels = getErrorLabels(error);
  if (labels) {
    if (labels.includes("TransientTransactionError")) {
      return true;
    }

    if (labels.includes("UnknownTransactionCommitResult")) {
      return true;
    }
  }

  const code = getErrorCode(error);
  if (typeof code === "number" && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return RETRYABLE_MESSAGES.some((candidate) => message.includes(candidate));
}

export async function backoffWithJitter(
  attempt: number,
  baseMs: number,
  maxMs: number,
): Promise<void> {
  const exponentialDelay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitteredDelay = Math.floor(Math.random() * exponentialDelay);
  const finalDelay = Math.max(jitteredDelay, 10);

  return new Promise((resolve) => setTimeout(resolve, finalDelay));
}
