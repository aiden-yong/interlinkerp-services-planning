import { randomUUID } from 'node:crypto';
import { App, REQUIRED_ENV } from './app';
import { ConfigError, requireAll } from './config/env';
import { envelope, json } from './http/responses';

let app: App | undefined;

export function getApp(): App {
  return (app ??= new App());
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
  return getApp().kernel().handle(request);
}
