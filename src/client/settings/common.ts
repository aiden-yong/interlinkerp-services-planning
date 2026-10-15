import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

const FALLBACK = 'Something went wrong. Please try again.';

function fieldMessages(error: unknown): [string, string][] {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) return [];
  return Object.entries(error.details as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

/** An error as one readable sentence, including every field message from a 422. Failures that are not API errors get a fixed message. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return FALLBACK;
  return [error.message, ...fieldMessages(error).map(([f, v]) => `${f}: ${v}`)].join(' ');
}

/**
 * Splits an error for a form: messages for fields in `known` go on those inputs,
 * everything else stays in `message` so nothing the server said is lost.
 */
export function describeError(error: unknown, known: string[]): { message: string; fields: Record<string, string> } {
  if (!(error instanceof ApiError)) return { message: FALLBACK, fields: {} };
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  for (const [field, text] of fieldMessages(error)) {
    if (known.includes(field)) fields[field] = text;
    else rest.push(`${field}: ${text}`);
  }
  const message = Object.keys(fields).length > 0 && rest.length === 0 ? '' : [error.message, ...rest].join(' ');
  return { message, fields };
}

/** Runs one action at a time. A second call while one is running is ignored, so buttons cannot double-submit. */
export function useBusy(): { busy: boolean; run: <T>(work: () => Promise<T>) => Promise<T | undefined> } {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const result = await load();
      if (mine !== latest.current) return; // a newer request replaced this one
      setData(result);
      setError(null);
    } catch (e) {
      if (mine === latest.current) setError(errorText(e));
    }
  }, deps);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}
