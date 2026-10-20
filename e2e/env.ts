/** Settings for the browser tests' own dev server. Nothing here is a real secret. */
export const E2E_PORT = 3200;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const ORG = 'e2e';
export const ZONE = 'Asia/Kuala_Lumpur';
export const CRON_SECRET = 'e2e-cron-secret';
/** The test database: the browser tests empty it, exactly like the integration tests do. */
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://planning:planning-dev-only@localhost:5432/planning_test';

export const SERVER_ENV: Record<string, string> = {
  NEXT_DIST_DIR: '.next-e2e',
  APP_ENV: 'development',
  SERVICE_ID: 'planning-api',
  OPENAPI_EXTENSION_KEY: 'x-e2e',
  ORGANISATION_ID: ORG,
  DEFAULT_TIMEZONE: ZONE,
  DATABASE_URL,
  GATEWAY_URL: 'https://gateway.invalid',
  PUBLIC_URL: BASE_URL,
  SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
  CRON_SECRET,
  GATEWAY_BADGES: 'off',
  // The signed-in developer is a Planning Manager; tests switch people with the identity picker's cookie.
  DEV_USER_EMAIL: 'manager@example.com',
  DEV_USER_NAME: 'Mona Manager',
  DEV_USER_ROLE: 'admin',
  DEV_EMPLOYEE_REF: '',
  // No roster service: the directory is seeded, so nothing calls out.
  INTERLINK_CLIENT_ID: '',
  INTERLINK_CLIENT_SECRET: '',
  SMTP_URL: '',
  MAIL_FROM: '',
};
