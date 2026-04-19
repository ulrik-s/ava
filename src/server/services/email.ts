/**
 * SMTP-utskick via Office 365 (eller annan SMTP-server) för automatiska
 * månads- och påminnelsebrev för avbetalningsplaner.
 *
 * Env:
 *   SMTP_HOST  — default "smtp.office365.com"
 *   SMTP_PORT  — default 587
 *   SMTP_USER  — inloggningsadress (måste stämma med SMTP_FROM för O365)
 *   SMTP_PASS  — lösenord / app-password
 *   SMTP_FROM  — "Advokatbyrån <faktura@exempel.se>"
 *
 * Transporten skapas lazy + cachat: första anropet initierar, resten
 * återanvänder. Gör `__resetEmailTransportForTests()` tillgängligt för
 * testsuiten.
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
    throw new Error(
      "SMTP_USER och SMTP_PASS måste sättas för att skicka e-post.",
    );
  }
  cached = nodemailer.createTransport({
    host,
    port,
    // Office 365 kräver STARTTLS på 587 (secure=false + requireTLS).
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
  });
  return cached;
}

/** Endast för tester — töm cachad transport så mocks kan återinitieras. */
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

// ─── Mall-hjälpare ──────────────────────────────────────────────

function kr(ore: number): string {
  const sek = ore / 100;
  return `${sek.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export interface PaymentReminderContext {
  recipientEmail: string;
  recipientName: string;
  matterNumber: string;
  matterTitle: string;
  invoiceAmount: number;     // öre — totalsumma på planen
  monthlyAmount: number;     // öre
  dayOfMonth: number;
  remainingAmount: number;   // öre — kvar att betala
  organizationName: string;
  organizationContact?: string;
  bankgiro?: string;
}

/** Månadens betalning förfaller idag. */
export async function sendPaymentDue(ctx: PaymentReminderContext): Promise<void> {
  const subject = `Månadens betalning — ${ctx.matterNumber} ${ctx.matterTitle}`;
  const text = [
    `Hej ${ctx.recipientName},`,
    ``,
    `Detta är en påminnelse om att månadens avbetalning enligt er plan för ärende`,
    `${ctx.matterNumber} — ${ctx.matterTitle} förfaller idag.`,
    ``,
    `  Månadsbelopp:        ${kr(ctx.monthlyAmount)}`,
    `  Kvar att betala:     ${kr(ctx.remainingAmount)}`,
    ctx.bankgiro ? `  Bankgiro:            ${ctx.bankgiro}` : ``,
    ``,
    `Med vänlig hälsning,`,
    ctx.organizationName,
    ctx.organizationContact ?? ``,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");
  await sendEmail({ to: ctx.recipientEmail, subject, text });
}

/** Påminnelse: 10 dagar efter förfallodagen, ingen betalning registrerad. */
export async function sendPaymentOverdue(ctx: PaymentReminderContext): Promise<void> {
  const subject = `PÅMINNELSE: Uteblivet månadsbelopp — ${ctx.matterNumber}`;
  const text = [
    `Hej ${ctx.recipientName},`,
    ``,
    `Vi har inte kunnat registrera er månatliga avbetalning för ärende`,
    `${ctx.matterNumber} — ${ctx.matterTitle}. Förfallodag var den ${ctx.dayOfMonth}:e`,
    `och mer än 10 dagar har nu passerat.`,
    ``,
    `  Månadsbelopp:        ${kr(ctx.monthlyAmount)}`,
    `  Kvar att betala:     ${kr(ctx.remainingAmount)}`,
    ctx.bankgiro ? `  Bankgiro:            ${ctx.bankgiro}` : ``,
    ``,
    `Vänligen betala snarast eller kontakta oss om ni behöver justera planen.`,
    ``,
    `Med vänlig hälsning,`,
    ctx.organizationName,
    ctx.organizationContact ?? ``,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");
  await sendEmail({ to: ctx.recipientEmail, subject, text });
}
