import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { App, REQUIRED_ENV } from './app';
import { ConfigError, requireAll } from './config/env';
import { envelope, json } from './http/responses';

let app: App | undefined;
const loggedAfterErrors = new Set<string>();

export function getApp(): App {
  return (app ??= new App());
}

/**
 * Backlog item 17: only people using the app start a delivery sweep. Health probes, the OpenAPI document and the
 * crons (which deliver on their own) never do, so the gateway's polling costs no background work.
 */
export function startsDelivery(request: Request): boolean {
  return new URL(request.url).pathname.startsWith('/api/');
}

/** Every API route file hands its requests to this. */
export async function handleApi(request: Request): Promise<Response> {
  try {
    requireAll(REQUIRED_ENV);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[planning-api] ${error.message}`);
    const cid = randomUUID();
    return json(500, envelope('INTERNAL_ERROR', 'The service is misconfigured. See the server log.', cid, null), { 'X-Correlation-ID': cid });
  }
  const app = getApp();
  const response = await app.kernel().handle(request);
  if (!startsDelivery(request)) return response;
  try {
    after(() => app.deliveryTrigger().kick()); // D1: deliver queued notices after the response is sent
  } catch (error) {
    // Outside a Next.js request (scripts) the daily cron still delivers; anything else is worth one log line per distinct error.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('outside a request scope') && !loggedAfterErrors.has(message)) {
      loggedAfterErrors.add(message);
      console.error(`[planning-api] could not schedule delivery after the response: ${message}`);
    }
  }
  return response;
}
