import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  correlationId: string;
  userId?: string;
  clientRequestId?: string;
  clientBootId?: string;
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

export function getClientRequestId(): string | undefined {
  return getRequestContext()?.clientRequestId;
}

export function getClientBootId(): string | undefined {
  return getRequestContext()?.clientBootId;
}

export function setRequestContextUserId(userId: string | undefined): void {
  const context = getRequestContext();
  if (!context || !userId) {
    return;
  }

  context.userId = userId;
}
