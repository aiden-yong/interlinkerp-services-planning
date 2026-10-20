import { DateTime } from 'luxon';
import { HttpError } from './errors';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Largest page of a short list (employees, managers, roles); also the default, so callers that never page get everything. */
export const LIST_MAX = 1000;

export interface Page {
  limit: number;
  offset: number;
}

/** One page of an in-memory list, with the paging that produced it (contract SS-12). */
export function slicePage<T>(items: T[], page: Page): { items: T[]; pagination: Page & { total: number } } {
  return { items: items.slice(page.offset, page.offset + page.limit), pagination: { ...page, total: items.length } };
}

/**
 * Reads and validates one request body or query string, collecting every
 * problem so the caller gets all field errors in one 422 (contract SS-11).
 */
export class Input {
  private readonly errors: Record<string, string> = {};

  constructor(private readonly data: Record<string, unknown>) {}

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  raw(key: string): unknown {
    return this.data[key];
  }

  string(key: string, max: number, required = false): string | null {
    const value = this.data[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string') {
      this.error(key, 'Must be a string.');
      return null;
    }
    const trimmed = value.trim();
    if ([...trimmed].length > max) {
      this.error(key, `Must be at most ${max} characters.`);
      return null;
    }
    return trimmed;
  }

  int(key: string, min: number, max: number, fallback: number | null = null): number | null {
    const value = this.data[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.error(key, 'Must be a whole number.');
      return fallback;
    }
    if (value < min || value > max) {
      this.error(key, `Must be between ${min} and ${max}.`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback = false): boolean {
    const value = this.data[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') {
      this.error(key, 'Must be true or false.');
      return fallback;
    }
    return value;
  }

  /** ISO 8601 with an explicit offset; returned as a UTC Date, seconds dropped. */
  instant(key: string, required = false): Date | null {
    const value = this.data[key];
    if (value === undefined || value === null || value === '') {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string' || !INSTANT.test(value)) {
      this.error(key, 'Use an ISO 8601 date-time with a time zone offset, e.g. 2026-10-13T09:00:00+08:00.');
      return null;
    }
    const parsed = DateTime.fromISO(value, { setZone: true });
    if (!parsed.isValid || parsed.toISODate() !== value.slice(0, 10)) {
      this.error(key, 'Not a real date-time.');
      return null;
    }
    return parsed.toUTC().startOf('minute').toJSDate();
  }

  date(key: string, required = false): string | null {
    const value = this.data[key];
    if (value === undefined || value === null || value === '') {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (typeof value !== 'string' || !DATE.test(value) || DateTime.fromISO(value).toISODate() !== value) {
      this.error(key, 'Use a real date in YYYY-MM-DD format.');
      return null;
    }
    return value;
  }

  /** Inclusive [from, to]. */
  dateRange(fromKey: string, toKey: string, maxDays: number): [string, string] | null {
    const from = this.date(fromKey, true);
    const to = this.date(toKey, true);
    if (!from || !to) return null;
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days < 1) {
      this.error(toKey, `Must be on or after ${fromKey}.`);
      return null;
    }
    if (days > maxDays) {
      this.error(toKey, `The range can be at most ${maxDays} days.`);
      return null;
    }
    return [from, to];
  }

  stringList(key: string, maxItems: number, required = false): string[] | null {
    const value = this.data[key];
    if (value === undefined || value === null) {
      if (required) this.error(key, 'This field is required.');
      return null;
    }
    if (!Array.isArray(value) || value.length > maxItems) {
      this.error(key, `Must be a list of at most ${maxItems} strings.`);
      return null;
    }
    if (!value.every((item) => typeof item === 'string' && item !== '' && item.length <= 64)) {
      this.error(key, 'Every item must be a non-empty string of at most 64 characters.');
      return null;
    }
    return [...new Set(value as string[])];
  }

  /**
   * Contract SS-12 paging from a query string: `limit` defaults to `defaultLimit`, an oversized limit is clamped to
   * `maxLimit` (not rejected), and `limit` below 1 or `offset` below 0 is a validation error.
   */
  page(defaultLimit: number, maxLimit: number): Page {
    const read = (key: string, fallback: number, min: number): number => {
      const value = this.data[key];
      if (value === undefined || value === '') return fallback;
      const n = Number(value);
      if (typeof value !== 'string' || !/^-?\d+$/.test(value) || !Number.isSafeInteger(n)) {
        this.error(key, 'Must be a whole number.');
        return fallback;
      }
      if (n < min) {
        this.error(key, `Must be at least ${min}.`);
        return fallback;
      }
      return n;
    };
    return { limit: Math.min(read('limit', defaultLimit, 1), maxLimit), offset: read('offset', 0, 0) };
  }

  error(key: string, message: string): void {
    this.errors[key] ??= message;
  }

  check(): void {
    if (Object.keys(this.errors).length > 0) throw HttpError.validation(this.errors);
  }
}
