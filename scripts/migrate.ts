// Usage: npm run db:migrate   (applies drizzle/ to DATABASE_URL)
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadLocalEnv } from '../src/server/config/env';
import { createDatabase } from '../src/server/db/client';

loadLocalEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const database = createDatabase(url);
await migrate(database.db, { migrationsFolder: 'drizzle' });
await database.close();
console.log('Migrations applied.');
