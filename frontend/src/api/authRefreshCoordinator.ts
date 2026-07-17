export interface RetryableAuthRequest {
  _retry?: boolean;
}

export function shouldAttemptAuthRefresh(
  status: number | undefined,
  request: RetryableAuthRequest | undefined,
  bypassRefresh: boolean,
): boolean {
  return (
    status === 401 &&
    request !== undefined &&
    !request._retry &&
    !bypassRefresh
  );
}

export class AuthRefreshCoordinator {
  private refreshPromise: Promise<void> | null = null;

  async waitForRefresh(refresh: () => Promise<void>): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = Promise.resolve()
        .then(refresh)
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    await this.refreshPromise;
  }
}
