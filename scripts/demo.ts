// Usage: npm run build:demo  (the demo project's Vercel build: migrates, then builds)
//        npm run demo:reset  (reloads the sample data from your machine)
// Both refuse any database whose name doesn't contain "demo", so they can never touch real data.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { App } from '../src/server/app';
import { loadLocalEnv } from '../src/server/config/env';
import { isDemoDatabase } from '../src/server/demo/demo';

loadLocalEnv();
const command = process.argv[2];
if (!isDemoDatabase(process.env.DATABASE_URL)) {
  console.error('Refusing to run: DATABASE_URL must name a database whose name contains "demo".');
  process.exit(1);
}
const app = new App();
if (command === 'migrate') {
  await migrate(app.database().db, { migrationsFolder: 'drizzle' });
  console.log('Demo database migrated. The first visit loads the sample data.');
} else if (command === 'reset') {
  await app.demoSeeder().reset();
  console.log('Sample data reloaded.');
} else {
  console.error('Usage: tsx scripts/demo.ts migrate|reset');
  process.exitCode = 1;
}
await app.database().close();
