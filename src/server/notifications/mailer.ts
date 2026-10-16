import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Logger } from '../http/kernel';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** FR-NTF-04 email. Never throws; a failure is a result the sweep retries. */
export interface Mailer {
  send(message: MailMessage): Promise<SendResult>;
}

export async function withTimeout(work: Promise<unknown>, ms: number): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: `Timed out after ${ms} ms.` }), ms);
  });
  const sent = work.then((): SendResult => ({ ok: true }), (error: unknown): SendResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return Promise.race([sent, timeout]).finally(() => clearTimeout(timer));
}

/** Throws (without echoing the URL) unless this is a well-formed smtp:// or smtps:// URL with decodable credentials. */
function assertSmtpUrl(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') throw new Error('scheme');
  if (!url.hostname) throw new Error('host');
  decodeURIComponent(url.username);
  decodeURIComponent(url.password);
}

/** D2: any SMTP provider, e.g. smtps://user:app-password@smtp.gmail.com:465. */
export class SmtpMailer implements Mailer {
  private transport: Transporter | null = null;

  constructor(private readonly url: string, private readonly from: string, private readonly timeoutMs = 10_000) {}

  /** Built on first send. A malformed URL makes nodemailer throw with the whole URL (and password) in the message, so that message is never kept. */
  async send(message: MailMessage): Promise<SendResult> {
    let transport: Transporter;
    try {
      if (!this.transport) {
        assertSmtpUrl(this.url);
        const options: SMTPTransport.Options = { url: this.url, connectionTimeout: this.timeoutMs, greetingTimeout: this.timeoutMs, socketTimeout: this.timeoutMs };
        this.transport = nodemailer.createTransport(options);
      }
      transport = this.transport;
    } catch {
      return { ok: false, error: 'SMTP_URL is not a valid SMTP URL.' };
    }
    return withTimeout(transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text }), this.timeoutMs);
  }
}

/** Used when SMTP_URL or MAIL_FROM is unset, so local development needs nothing. */
export class LogMailer implements Mailer {
  constructor(private readonly log: Logger) {}

  async send(message: MailMessage): Promise<SendResult> {
    this.log(`[mail] not configured; would send "${message.subject}" to one recipient`);
    return { ok: true };
  }
}
