import { getErrorCode, getErrorLabels } from "@/utils/errors";

interface TransactionErrorEvidence {
  hasMaxTimeMSExpired: boolean;
  hasTransientTransactionError: boolean;
  hasUnknownTransactionCommitResult: boolean;
}

function inspectTransactionErrorCauseChain(
  error: unknown,
): TransactionErrorEvidence {
  const evidence: TransactionErrorEvidence = {
    hasMaxTimeMSExpired: false,
    hasTransientTransactionError: false,
    hasUnknownTransactionCommitResult: false,
  };
  const visited = new Set<object>();
  let current = error;

  while (current !== null && typeof current === "object") {
    if (visited.has(current)) break;
    visited.add(current);

    const labels = getErrorLabels(current);
    if (labels?.includes("UnknownTransactionCommitResult")) {
      evidence.hasUnknownTransactionCommitResult = true;
    }
    if (labels?.includes("TransientTransactionError")) {
      evidence.hasTransientTransactionError = true;
    }

    const errorLike = current as {
      cause?: unknown;
      codeName?: unknown;
    };
    if (
      getErrorCode(current) === 50 ||
      errorLike.codeName === "MaxTimeMSExpired"
    ) {
      evidence.hasMaxTimeMSExpired = true;
    }

    current = errorLike.cause;
  }

  return evidence;
}

export function isUnknownTransactionCommitResult(error: unknown): boolean {
  return inspectTransactionErrorCauseChain(error)
    .hasUnknownTransactionCommitResult;
}

export function isTransientTransactionError(error: unknown): boolean {
  return inspectTransactionErrorCauseChain(error).hasTransientTransactionError;
}

export function isMaxTimeMSExpiredError(error: unknown): boolean {
  return inspectTransactionErrorCauseChain(error).hasMaxTimeMSExpired;
}

export function isRetryableTransactionBodyError(error: unknown): boolean {
  const evidence = inspectTransactionErrorCauseChain(error);
  return (
    !evidence.hasUnknownTransactionCommitResult &&
    evidence.hasTransientTransactionError
  );
}

export function isRetryableTransactionError(error: unknown): boolean {
  return isRetryableTransactionBodyError(error);
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
