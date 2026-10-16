import nodemailer, { type Transporter } from 'nodemailer';
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

/** D2: any SMTP provider, e.g. smtps://user:app-password@smtp.gmail.com:465. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(url: string, private readonly from: string, private readonly timeoutMs = 10_000) {
    this.transport = nodemailer.createTransport(url);
  }

  send(message: MailMessage): Promise<SendResult> {
    return withTimeout(this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text }), this.timeoutMs);
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
