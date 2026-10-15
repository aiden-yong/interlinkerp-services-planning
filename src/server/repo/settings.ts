import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { organisationSettings } from '../db/schema';

export interface OrgSettings {
  country_code: string | null;
  region_code: string | null;
  timezone: string;
}

export class SettingsRepository {
  constructor(private readonly db: Db, private readonly org: string, private readonly defaultTimezone: string) {}

  async get(): Promise<OrgSettings> {
    const [row] = await this.db.select().from(organisationSettings).where(eq(organisationSettings.organisationId, this.org)).limit(1);
    return row ? { country_code: row.countryCode, region_code: row.regionCode, timezone: row.timezone } : { country_code: null, region_code: null, timezone: this.defaultTimezone };
  }

  async timezone(): Promise<string> {
    return (await this.get()).timezone;
  }

  async save(settings: OrgSettings, now: Date): Promise<void> {
    const values = { countryCode: settings.country_code, regionCode: settings.region_code, timezone: settings.timezone, updatedAt: now };
    await this.db.insert(organisationSettings).values({ organisationId: this.org, ...values })
      .onConflictDoUpdate({ target: organisationSettings.organisationId, set: values });
  }
}
