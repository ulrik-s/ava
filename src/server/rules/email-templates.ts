/**
 * Mall-registry för regel-stegget `email.send`. Mappar templates-namn →
 * en renderingsfunktion som producerar `{ subject, text, html? }`.
 *
 * Att flytta hit (snarare än hardcode i `handlers.ts`) ger oss:
 *   - Översikt över alla giltiga template-namn på ett ställe
 *   - Testbarhet (rendering är ren funktion utan side-effects)
 *   - Möjlighet att senare ladda mallar från DB istället för kod
 */

import type { PaymentReminderContext } from "../services/email";

export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}

type Renderer = (vars: Record<string, unknown>) => RenderedEmail;

/**
 * Hämta en sträng-prop från vars, kasta om saknas/fel typ.
 * Tvingar regelförfattaren att skicka in vad mallen behöver.
 */
function str(vars: Record<string, unknown>, key: string): string {
  const v = vars[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Email template behöver "${key}" (sträng)`);
  }
  return v;
}

function num(vars: Record<string, unknown>, key: string): number {
  const v = vars[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Email template behöver "${key}" (nummer)`);
  }
  return v;
}

/** Generisk mall — regelförfattaren skickar in subject + text själv. */
const genericRenderer: Renderer = (vars) => ({
  subject: str(vars, "subject"),
  text: str(vars, "text"),
  ...(typeof vars.html === "string" ? { html: vars.html } : {}),
});

/**
 * payment-reminder: 14-dagars första-påminnelse. Förväntar sig samma
 * fält som `PaymentReminderContext` så vi kan delegera till befintliga
 * `sendPaymentDue`. Men vi *renderar* här istället för att gå direkt
 * mot transporten — det gör det testbart.
 */
const paymentReminderRenderer: Renderer = (vars) => {
  const ctx: PaymentReminderContext = {
    recipientEmail: str(vars, "recipientEmail"),
    recipientName: str(vars, "recipientName"),
    matterNumber: str(vars, "matterNumber"),
    matterTitle: str(vars, "matterTitle"),
    invoiceAmount: num(vars, "invoiceAmount"),
    monthlyAmount: num(vars, "monthlyAmount"),
    dayOfMonth: num(vars, "dayOfMonth"),
    remainingAmount: num(vars, "remainingAmount"),
    organizationName: str(vars, "organizationName"),
    organizationContact: typeof vars.organizationContact === "string" ? vars.organizationContact : undefined,
    bankgiro: typeof vars.bankgiro === "string" ? vars.bankgiro : undefined,
  };
  const subject = `Månadens betalning ${ctx.matterNumber} – ${ctx.matterTitle}`;
  const text = renderPaymentBody(ctx, /* overdue */ false);
  return { subject, text };
};

const paymentOverdueRenderer: Renderer = (vars) => {
  const ctx: PaymentReminderContext = paymentReminderRenderer(vars) as unknown as PaymentReminderContext; // återanvänd vars-kontroll
  // Vi behöver fortfarande ctx-fälten — bygg om från vars
  const built: PaymentReminderContext = {
    recipientEmail: str(vars, "recipientEmail"),
    recipientName: str(vars, "recipientName"),
    matterNumber: str(vars, "matterNumber"),
    matterTitle: str(vars, "matterTitle"),
    invoiceAmount: num(vars, "invoiceAmount"),
    monthlyAmount: num(vars, "monthlyAmount"),
    dayOfMonth: num(vars, "dayOfMonth"),
    remainingAmount: num(vars, "remainingAmount"),
    organizationName: str(vars, "organizationName"),
    organizationContact: typeof vars.organizationContact === "string" ? vars.organizationContact : undefined,
    bankgiro: typeof vars.bankgiro === "string" ? vars.bankgiro : undefined,
  };
  void ctx; // tysta unused
  const subject = `PÅMINNELSE: Månadens betalning ${built.matterNumber} – ${built.matterTitle}`;
  const text = renderPaymentBody(built, /* overdue */ true);
  return { subject, text };
};

function kr(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function renderPaymentBody(ctx: PaymentReminderContext, overdue: boolean): string {
  const lines: string[] = [
    `Hej ${ctx.recipientName},`,
    "",
    overdue
      ? `Vi har inte sett betalningen för ärende ${ctx.matterNumber} (${ctx.matterTitle}). Förfallodag den ${ctx.dayOfMonth}. Det har gått mer än 10 dagar.`
      : `Det är dags för månadens betalning för ärende ${ctx.matterNumber} (${ctx.matterTitle}).`,
    "",
    `Belopp: ${kr(ctx.monthlyAmount)}`,
    `Kvar att betala: ${kr(ctx.remainingAmount)}`,
  ];
  if (ctx.bankgiro) lines.push(`Bankgiro: ${ctx.bankgiro}`);
  lines.push("", `Med vänlig hälsning,`, ctx.organizationName);
  if (ctx.organizationContact) lines.push(ctx.organizationContact);
  return lines.join("\n");
}

export const EMAIL_TEMPLATES: Record<string, Renderer> = {
  generic: genericRenderer,
  "payment-reminder": paymentReminderRenderer,
  "payment-overdue": paymentOverdueRenderer,
};

export function renderEmail(template: string, vars: Record<string, unknown>): RenderedEmail {
  const renderer = EMAIL_TEMPLATES[template];
  if (!renderer) throw new Error(`Okänd email-mall: "${template}"`);
  return renderer(vars);
}
