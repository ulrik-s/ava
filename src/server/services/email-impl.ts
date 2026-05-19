/**
 * `email-impl.ts` — server-only impl med nodemailer.
 *
 * Importeras BARA via `await import("./email-impl")` från `email.ts`
 * (dynamic import). Bundler:n följer inte dynamic imports statiskt,
 * så denna modul + nodemailer hamnar aldrig i client-bundle:n.
 */

import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

function getTransport(): Transporter {
  if (cached) return cached;
  const host = process.env.SMTP_HOST ?? "smtp.office365.com";
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("SMTP_USER och SMTP_PASS måste sättas för att skicka e-post.");
  }
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
  });
  return cached;
}

export function __resetEmailTransportForTests(): void {
  cached = null;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!from) throw new Error("SMTP_FROM eller SMTP_USER måste vara satt.");
  await getTransport().sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  });
}
