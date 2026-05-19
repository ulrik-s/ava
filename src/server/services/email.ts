/**
 * `email.ts` — browser-safe wrapper.
 *
 * Den faktiska nodemailer-koden ligger i `email-impl.ts` och laddas
 * via dynamic import vid första anrop. Detta gör att `appRouter`
 * (som transitivt importerar denna fil via rules-handlers) kan
 * bundlas för browser utan att dra in nodemailer + fs/dns/net/tls.
 *
 * SMTP-utskick via Office 365 (eller annan SMTP-server) för automatiska
 * månads- och påminnelsebrev för avbetalningsplaner.
 *
 * Env (server-side):
 *   SMTP_HOST  — default "smtp.office365.com"
 *   SMTP_PORT  — default 587
 *   SMTP_USER  — inloggningsadress
 *   SMTP_PASS  — lösenord / app-password
 *   SMTP_FROM  — "Advokatbyrån <faktura@exempel.se>"
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface PaymentReminderContext {
  recipientEmail: string;
  recipientName: string;
  matterNumber: string;
  matterTitle: string;
  invoiceAmount: number;
  monthlyAmount: number;
  dayOfMonth: number;
  remainingAmount: number;
  organizationName: string;
  organizationContact?: string;
  bankgiro?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const impl = await import("./email-impl");
  return impl.sendEmail(input);
}

export async function __resetEmailTransportForTests(): Promise<void> {
  const impl = await import("./email-impl");
  impl.__resetEmailTransportForTests();
}

function kr(ore: number): string {
  const sek = ore / 100;
  return `${sek.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

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
  ].filter((l) => l !== null && l !== undefined).join("\n");
  await sendEmail({ to: ctx.recipientEmail, subject, text });
}

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
  ].filter((l) => l !== null && l !== undefined).join("\n");
  await sendEmail({ to: ctx.recipientEmail, subject, text });
}
