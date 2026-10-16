import { describe, expect, it } from 'vitest';
import { LogMailer, withTimeout } from './mailer';

describe('mailer', () => {
  it('gives up on a send that hangs (Review Focus 3)', async () => {
    const result = await withTimeout(new Promise<never>(() => {}), 20);
    expect(result).toEqual({ ok: false, error: 'Timed out after 20 ms.' });
  });

  it('logs instead of sending when not configured, without the address', async () => {
    const lines: string[] = [];
    expect(await new LogMailer((l) => lines.push(l)).send({ to: 'ana@example.com', subject: 'Hi', text: 'x' })).toEqual({ ok: true });
    expect(lines.join()).not.toContain('ana@example.com');
  });
});
