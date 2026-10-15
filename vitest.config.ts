import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', environment: 'node', include: ['src/server/**/*.test.ts'], exclude: ['src/server/**/*.int.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/server/**/*.int.test.ts'],
          poolOptions: { forks: { singleFork: true } }, // one shared test database
          globalSetup: ['src/server/test/globalSetup.ts'],
          testTimeout: 15_000,
        },
      },
      { extends: true, test: { name: 'client', environment: 'jsdom', include: ['src/client/**/*.test.{ts,tsx}'] } },
    ],
  },
});
