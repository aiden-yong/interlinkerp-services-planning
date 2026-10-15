// Loads 50 employees, 3 roles and 300 shifts into the current week, for performance checks and demos.
// Refuses to run without the flag, so it can never be pointed at real data by accident.
// Usage: npm run db:seed-demo -- --yes-this-is-a-demo-database
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { App } from '../src/server/app';
import { loadLocalEnv } from '../src/server/config/env';
import { employeeDirectory, shifts } from '../src/server/db/schema';

if (!process.argv.includes('--yes-this-is-a-demo-database')) {
  console.error('Refusing to run. This inserts demo employees and shifts. Re-run with --yes-this-is-a-demo-database');
  process.exit(1);
}
loadLocalEnv();

const app = new App();
const { db } = app.database();
const org = app.organisationId();
const zone = await app.settings().timezone();
const now = new Date();
const monday = DateTime.now().setZone(zone).startOf('week');

const roleIds: string[] = [];
const existing = await app.roles().all();
for (const [name, color] of [['Technician', '#16A34A'], ['Dispatcher', '#2563EB'], ['Supervisor', '#9333EA']] as const) {
  roleIds.push(existing.find((r) => r.name === name)?.id ?? (await app.roles().create(name, color, now)).id);
}

const day: [string, string][] = [['09:00', '13:00'], ['14:00', '18:00']];
const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] };

for (let i = 1; i <= 50; i++) {
  const ref = `DEMO-${String(i).padStart(2, '0')}`;
  const role = roleIds[i % 3];
  await db.insert(employeeDirectory)
    .values({ organisationId: org, employeeRef: ref, displayName: `Demo Employee ${i}`, departmentId: `DEP-${i % 4}`, departmentName: `Team ${i % 4}`, status: 'Active', fetchedAt: now })
    .onConflictDoUpdate({ target: [employeeDirectory.organisationId, employeeDirectory.employeeRef], set: { fetchedAt: now } });
  await app.profiles().save({ employeeRef: ref, roleIds: [role], defaultRoleId: role, timezone: null, workingHours: hours }, now);
  await db.insert(shifts).values(Array.from({ length: 6 }, (_, d) => {
    const start = monday.plus({ days: d }).set({ hour: d === 5 ? 10 : 9 });
    return {
      id: randomUUID(), organisationId: org, employeeRef: i % 10 === 0 && d === 5 ? null : ref, roleId: role,
      startAt: start.toJSDate(), endAt: start.plus({ hours: 8 }).toJSDate(), breakMinutes: 60,
      state: d < 3 ? 'published' : 'draft', publishedAt: d < 3 ? now : null, createdBy: 'seed', createdAt: now, updatedAt: now,
    };
  }));
}
await app.database().close();
console.log(`Seeded 50 employees and 300 shifts for the week of ${monday.toISODate()}.`);
