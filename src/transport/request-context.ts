import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  startTime: number;
  traceId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
