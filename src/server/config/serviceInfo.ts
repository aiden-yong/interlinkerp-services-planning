import { requireEnv } from './env';

/** Change in the same commit as any API change (NFR-09). */
export const SERVICE_VERSION = '0.2.0';

export interface ServiceInfo {
  serviceId: string;
  /** The OpenAPI extension key the gateway reads catalogue metadata from. */
  extensionKey: string;
}

export function serviceInfoFromEnv(): ServiceInfo {
  return { serviceId: requireEnv('SERVICE_ID'), extensionKey: requireEnv('OPENAPI_EXTENSION_KEY') };
}
