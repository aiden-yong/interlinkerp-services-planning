import { format } from 'node:util';
import { redactAddresses } from './scrub';

const PATCHED = Symbol.for('planning.redactConsole');

type Writer = (...args: unknown[]) => void;
type ConsoleLike = { error: Writer; warn: Writer; [PATCHED]?: true };

/**
 * DR-02 (backlog item 11): Next.js logs errors thrown while rendering server components itself, outside the
 * kernel's scrubbing. Routing console.error and console.warn through redactAddresses keeps directory email
 * addresses out of those lines too. Arguments are formatted exactly as console would, then redacted. Safe to call twice.
 */
export function redactConsole(target: ConsoleLike = console as unknown as ConsoleLike): void {
  if (target[PATCHED]) return;
  for (const level of ['error', 'warn'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => original(redactAddresses(format(...args)));
  }
  target[PATCHED] = true;
}
