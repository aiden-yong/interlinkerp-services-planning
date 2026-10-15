import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request values that outbound HTTP calls forward (contract SS-4). */
export const requestContext = new AsyncLocalStorage<{ correlationId: string }>();

export function currentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}
