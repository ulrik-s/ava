/**
 * SMTP-sender (#180) — nodemailer-backad `EmailSender`. Self-hosted only;
 * creds ur secrets-valvet (#79). Tunt I/O-skal — logiken/idempotensen bor i
 * dispatch-workern ([[dispatch-job]]).
 */

import nodemailer from "nodemailer";
import type { EmailSender } from "./email-sender";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Avsändaradress (From:). */
  from: string;
  /** STARTTLS/implicit TLS (default true för port 465). */
  secure?: boolean;
}

/** Bygg en SMTP-baserad EmailSender ur konfig (host/port/creds + from). */
export function createSmtpSender(cfg: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return {
    async sendMail(msg) {
      const info = await transport.sendMail({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      });
      return { messageId: info.messageId };
    },
  };
}
