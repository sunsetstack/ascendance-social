export class AmbiguousTransactionCommitError extends Error {
  constructor(
    public readonly commitAttempts: number,
    cause: unknown,
  ) {
    super(
      `Transaction commit outcome is unresolved after ${commitAttempts} attempts`,
      { cause },
    );
    this.name = "AmbiguousTransactionCommitError";
  }
}
