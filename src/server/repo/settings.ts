import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { organisationSettings } from '../db/schema';

export type GiveUpMode = 'switch' | 'unassign';

export interface OrgSettings {
  country_code: string | null;
  region_code: string | null;
  timezone: string;
  give_up_mode: GiveUpMode;
  unassign_window_days: number;
  recurrence_horizon_months: number;
  reminder_lead_minutes: number;
}

export class SettingsRepository {
  constructor(private readonly db: Db, private readonly org: string, private readonly defaultTimezone: string) {}

  async get(): Promise<OrgSettings> {
    const [row] = await this.db.select().from(organisationSettings).where(eq(organisationSettings.organisationId, this.org)).limit(1);
    return row
      ? {
        country_code: row.countryCode, region_code: row.regionCode, timezone: row.timezone, give_up_mode: row.giveUpMode as GiveUpMode,
        unassign_window_days: row.unassignWindowDays, recurrence_horizon_months: row.recurrenceHorizonMonths, reminder_lead_minutes: row.reminderLeadMinutes,
      }
      : { country_code: null, region_code: null, timezone: this.defaultTimezone, give_up_mode: 'switch', unassign_window_days: 2, recurrence_horizon_months: 6, reminder_lead_minutes: 60 };
  }

  async timezone(): Promise<string> {
    return (await this.get()).timezone;
  }

  async save(settings: OrgSettings, now: Date): Promise<void> {
    const values = {
      countryCode: settings.country_code,
      regionCode: settings.region_code,
      timezone: settings.timezone,
      giveUpMode: settings.give_up_mode,
      unassignWindowDays: settings.unassign_window_days,
      recurrenceHorizonMonths: settings.recurrence_horizon_months,
      reminderLeadMinutes: settings.reminder_lead_minutes,
      updatedAt: now,
    };
    await this.db.insert(organisationSettings).values({ organisationId: this.org, ...values })
      .onConflictDoUpdate({ target: organisationSettings.organisationId, set: values });
  }
}
