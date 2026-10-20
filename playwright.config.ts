import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_PORT, SERVER_ENV } from './e2e/env';

/** Backlog item 21: the four main flows in a real browser against `next dev` and the test database. */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // one shared database
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${E2E_PORT}`,
    url: `${BASE_URL}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: SERVER_ENV,
  },
});
