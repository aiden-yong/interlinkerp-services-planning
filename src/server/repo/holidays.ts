import { randomUUID } from 'node:crypto';
import { and, between, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { publicHolidays } from '../db/schema';
import { isUuid } from '../support/ids';

export interface Holiday {
  id: string;
  date: string;
  name: string;
  source: 'manual' | 'provider';
  hidden: boolean;
  edited: boolean;
}

const toHoliday = (r: typeof publicHolidays.$inferSelect): Holiday =>
  ({ id: r.id, date: r.holidayDate, name: r.name, source: r.source as Holiday['source'], hidden: r.hidden, edited: r.edited });

/** FR-CFG-04 */
export class HolidayRepository {
  constructor(private readonly db: Db, private readonly org: string) {}

  private where(id: string) {
    return and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.id, id));
  }

  async forYear(year: number): Promise<Holiday[]> {
    const rows = await this.db.select().from(publicHolidays)
      .where(and(eq(publicHolidays.organisationId, this.org), between(publicHolidays.holidayDate, `${year}-01-01`, `${year}-12-31`)))
      .orderBy(publicHolidays.holidayDate, publicHolidays.name);
    return rows.map(toHoliday);
  }

  async visibleBetween(fromDate: string, toDate: string): Promise<{ date: string; name: string }[]> {
    return this.db.select({ date: publicHolidays.holidayDate, name: publicHolidays.name }).from(publicHolidays)
      .where(and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.hidden, false), between(publicHolidays.holidayDate, fromDate, toDate)))
      .orderBy(publicHolidays.holidayDate);
  }

  async find(id: string): Promise<Holiday | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db.select().from(publicHolidays).where(this.where(id)).limit(1);
    return row ? toHoliday(row) : null;
  }

  async createManual(date: string, name: string, now: Date): Promise<Holiday> {
    const [row] = await this.db.insert(publicHolidays)
      .values({ id: randomUUID(), organisationId: this.org, holidayDate: date, name, source: 'manual', createdAt: now, updatedAt: now }).returning();
    return toHoliday(row);
  }

  async update(id: string, fields: { name?: string; hidden?: boolean }, now: Date): Promise<Holiday> {
    const [row] = await this.db.update(publicHolidays).set({
      ...(fields.name !== undefined ? { name: fields.name, edited: true } : {}),
      ...(fields.hidden !== undefined ? { hidden: fields.hidden } : {}),
      updatedAt: now,
    }).where(this.where(id)).returning();
    return toHoliday(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(publicHolidays).where(this.where(id));
  }

  /** New provider holidays are added; existing ones are refreshed unless a manager renamed them. `hidden` is never touched. */
  async syncFromProvider(list: { key: string; date: string; name: string }[], now: Date): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    for (const h of list) {
      const [existing] = await this.db.select().from(publicHolidays)
        .where(and(eq(publicHolidays.organisationId, this.org), eq(publicHolidays.providerKey, h.key))).limit(1);
      if (!existing) {
        await this.db.insert(publicHolidays).values({ id: randomUUID(), organisationId: this.org, holidayDate: h.date, name: h.name, source: 'provider', providerKey: h.key, createdAt: now, updatedAt: now });
        added++;
      } else if (!existing.edited && (existing.holidayDate !== h.date || existing.name !== h.name)) {
        await this.db.update(publicHolidays).set({ holidayDate: h.date, name: h.name, updatedAt: now }).where(this.where(existing.id));
        updated++;
      }
    }
    return { added, updated };
  }
}
