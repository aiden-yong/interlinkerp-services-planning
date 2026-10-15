import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI and Vercel use real environment variables.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
