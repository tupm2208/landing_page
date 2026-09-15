/**
 * @file The `mail` port: real SMTP, "not configured", memory (tests) and trial-mode adapters.
 *
 * The running site sent mail through nodemailer with SMTP_* variables and, when they were missing,
 * printed the link into the log and told the customer "link created, mail not sent". Both
 * behaviours are kept: `SmtpMailer` for a configured shop, `UnconfiguredMailer` otherwise.
 *
 * Trial mode (the default, see app.ts) NEVER mails anyone: `TrialModeMailer` throws the same
 * `TrialModeBlockedError` the HTTP client throws, so a module cannot mistake "blocked" for "sent".
 */

import type { Logger, MailMessage, MailResult, Mailer } from "../../contract";
import { TrialModeBlockedError } from "./trial-mode";

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** `true` when every SMTP field needed to send is present. */
export function smtpConfigured(s: Partial<SmtpSettings> | null | undefined): s is SmtpSettings {
  return Boolean(s && s.host && s.user && s.pass && (s.from || s.user));
}

/** The slice of a nodemailer transporter this port uses. Declared here so no type package is needed. */
interface Transporter {
  sendMail(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
}

/** SMTP through nodemailer (a runtime dependency of the landing package). */
export class SmtpMailer implements Mailer {
  private transporter: Transporter | null = null;

  constructor(private readonly settings: SmtpSettings, private readonly logger: Logger) {}

  private open(): Transporter {
    if (this.transporter) return this.transporter;
    // nodemailer ships no TypeScript types; the shape used is declared above.
    const nodemailer = require("nodemailer") as { createTransport(options: Record<string, unknown>): Transporter };
    this.transporter = nodemailer.createTransport({
      host: this.settings.host,
      port: this.settings.port || 587,
      secure: this.settings.secure,
      auth: { user: this.settings.user, pass: this.settings.pass }
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailResult> {
    try {
      await this.open().sendMail({
        from: this.settings.from || this.settings.user,
        to: message.to, subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {})
      });
      return { ok: true, configured: true };
    } catch (e) {
      this.logger.warn(`[mail] gửi tới ${message.to} hỏng: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, configured: true, reason: "gui_hong" };
    }
  }
}

/** No SMTP on this shop: nothing is sent; the log carries the text so the owner can act by hand. */
export class UnconfiguredMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<MailResult> {
    this.logger.warn(`[mail] SMTP chưa cấu hình — không gửi được "${message.subject}" tới ${message.to}. Nội dung: ${message.text.replace(/\s+/g, " ").slice(0, 300)}`);
    return { ok: false, configured: false, reason: "chua_cau_hinh" };
  }
}

/** Keeps every message in memory. Tests read `sent`. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { ok: true, configured: true };
  }
}

/** Trial mode: refuses to mail anyone, loudly, and records what would have gone out. */
export class TrialModeMailer implements Mailer {
  readonly blocked: MailMessage[] = [];

  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<MailResult> {
    this.blocked.push(message);
    this.logger.warn(`[mail] CHẾ ĐỘ THỬ chặn e-mail "${message.subject}" tới ${message.to}`);
    throw new TrialModeBlockedError(`mail:${message.to}`, "e-mail cho khách");
  }
}
