import { and, count, eq, gte, isNull, not, like, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { MAX_EMAIL_ATTEMPTS, notificationOutbox, notifications } from '../db/schema';
import type { Logger } from '../http/kernel';
import type { DirectoryRepository } from '../repo/directory';
import type { JobRuns } from '../repo/jobRuns';
import { MAX_OUTBOX_ATTEMPTS } from './deliveryService';

/** Backlog item 9: how stale the cached directory may get before someone should look (the refresh runs daily). */
export const DIRECTORY_ALERT_HOURS = 48;
/** The daily cron looks back a little over a day, so every failure is reported once. Retries finish within an hour. */
/** FR-NTF-05: the external scheduler calls the sweep every 5 minutes; this long without a run is worth an alert. */
export const SWEEP_ALERT_MINUTES = 30;
const WINDOW_MS = 25 * 3600_000;

/**
 * The daily check run by the notifications cron. Each problem becomes one log line starting with `[alert]`, which a
 * Vercel log drain or error tracker can match, and is returned in the cron response. Never throws.
 */
export class OpsCheck {
  constructor(private readonly db: Db, private readonly org: string, private readonly directory: DirectoryRepository, private readonly jobRuns: JobRuns, private readonly log: Logger) {}

  async run(now: Date): Promise<string[]> {
    const alerts: string[] = [];
    try {
      const since = new Date(now.getTime() - WINDOW_MS);
      const [emails] = await this.db.select({ n: count() }).from(notifications).where(and(
        eq(notifications.organisationId, this.org), gte(notifications.createdAt, since), isNull(notifications.emailedAt),
        sql`${notifications.emailAttempts} >= ${sql.raw(String(MAX_EMAIL_ATTEMPTS))}`, not(like(sql`coalesce(${notifications.emailError}, '')`, 'Skipped:%')),
      ));
      if (Number(emails?.n ?? 0) > 0) alerts.push(`${emails!.n} notification email(s) failed for good in the last day. See notifications.email_error.`);

      const [notices] = await this.db.select({ n: count() }).from(notificationOutbox).where(and(
        eq(notificationOutbox.organisationId, this.org), gte(notificationOutbox.createdAt, since),
        sql`${notificationOutbox.attempts} >= ${sql.raw(String(MAX_OUTBOX_ATTEMPTS))}`,
      ));
      if (Number(notices?.n ?? 0) > 0) alerts.push(`${notices!.n} notice(s) could not be delivered in the last day. See notification_outbox.last_error.`);

      const fetched = await this.directory.lastFetchedAt();
      const ageHours = fetched ? (now.getTime() - fetched.getTime()) / 3600_000 : Number.POSITIVE_INFINITY;
      if (ageHours > DIRECTORY_ALERT_HOURS) {
        alerts.push(fetched ? `The employee directory was last refreshed ${Math.floor(ageHours)} hours ago. Check the directory cron and the roster service.` : 'The employee directory has never been refreshed.');
      }

      const sweptAt = await this.jobRuns.lastStarted('sweep');
      if (!sweptAt) alerts.push('The 5-minute notification sweep has never run. Set up the external scheduler (README).');
      else {
        const minutes = Math.floor((now.getTime() - sweptAt.getTime()) / 60_000);
        if (minutes > SWEEP_ALERT_MINUTES) alerts.push(`The 5-minute notification sweep has not run for ${minutes} minutes. Check the external scheduler (README).`);
      }
    } catch (error) {
      alerts.push(`The daily check itself failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const alert of alerts) this.log(`[alert] ${alert}`);
    return alerts;
  }
}
