import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  correlationId: string;
  userId?: string;
};

const requestContextALS = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  work: () => T,
): T {
  return requestContextALS.run(context, work);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextALS.getStore();
}

export function getCorrelationId(): string | undefined {
  return getRequestContext()?.correlationId;
}

export function setRequestContextUserId(userId: string | undefined): void {
  const context = getRequestContext();
  if (!context || !userId) {
    return;
  }

  context.userId = userId;
}
