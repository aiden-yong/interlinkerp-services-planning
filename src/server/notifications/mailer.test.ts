import { describe, expect, it } from 'vitest';
import { LogMailer, SmtpMailer, withTimeout } from './mailer';

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

  it.each(['not a url', 'smtps://user:SECRETPASS@host:99999', 'smtps://user:SECRETPASS@host:0', 'smtps://user:p%ZZ@host'])('never throws or leaks a malformed SMTP_URL: %s', async (url) => {
    const mailer = new SmtpMailer(url, 'x@y.test');
    const result = await mailer.send({ to: 'ana@example.com', subject: 'Hi', text: 'x' });
    expect(result).toEqual({ ok: false, error: 'SMTP_URL is not a valid SMTP URL.' });
    expect(JSON.stringify(result)).not.toMatch(/SECRETPASS|not a url|p%ZZ/);
  });
});
