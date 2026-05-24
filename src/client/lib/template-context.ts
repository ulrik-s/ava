import Handlebars from "handlebars";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { labelForMatterRole } from "./labels";
import type { PrismaClient } from "@prisma/client";

// ─── Exported pure helper functions (also used by tests) ────────

export function formatDate(date: unknown): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date as string);
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateShort(date: unknown): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date as string);
  return d.toLocaleDateString("sv-SE");
}

export function formatAmount(amountInOre: unknown): string {
  if (amountInOre == null) return "0,00 kr";
  const sek = (Number(amountInOre) / 100).toFixed(2).replace(".", ",");
  return `${sek.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")} kr`;
}

export function formatHours(minutes: unknown): string {
  if (!minutes) return "0 tim";
  const m = Number(minutes);
  if (m % 60 === 0) return `${Math.floor(m / 60)} tim`;
  return `${(m / 60).toFixed(1).replace(".", ",")} tim`;
}

// Register as Handlebars helpers
Handlebars.registerHelper("formatDate", formatDate);
Handlebars.registerHelper("formatDateShort", formatDateShort);
Handlebars.registerHelper("formatAmount", formatAmount);
Handlebars.registerHelper("formatHours", formatHours);
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper("ne", (a: unknown, b: unknown) => a !== b);

export interface TemplateContext {
  matter: {
    id: string;
    matterNumber: string;
    title: string;
    description: string | null;
    status: string;
    matterType: string | null;
    createdAt: Date;
  };
  organization: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    orgNumber: string | null;
    bankgiro: string | null;
    logoBase64: string | null;   // data URL, e.g. "data:image/png;base64,..."
    hasLogo: boolean;
    offices: Array<{
      id: string;
      name: string;
      address: string | null;
      phone: string | null;
      email: string | null;
      isMain: boolean;
    }>;
    mainOffice: {
      id: string;
      name: string;
      address: string | null;
      phone: string | null;
      email: string | null;
      isMain: boolean;
    } | null;
  };
  contacts: Array<{
    name: string;
    role: string;
    roleLabel: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    personalNumber: string | null;
    orgNumber: string | null;
    notes: string | null;
  }>;
  klient: TemplateContext["contacts"][number] | null;
  motpart: TemplateContext["contacts"][number] | null;
  /**
   * Aktuell mottagare när ett dokument genereras per-mottagare. Null om
   * dokumentet inte är mottagar-specifikt. Typiskt den kontakt adressen
   * i dokumentet riktar sig till (klient, motpart, domstol, ...).
   */
  recipient: TemplateContext["contacts"][number] | null;
  /** Alla valda mottagare (t.ex. vid loop över flera i samma render). */
  recipients: TemplateContext["contacts"];
  timeEntries: Array<{
    date: Date;
    description: string;
    minutes: number;
    hours: string;
    amount: number;
    userName: string;
    billable: boolean;
  }>;
  expenses: Array<{
    date: Date;
    description: string;
    amount: number;
    userName: string;
    billable: boolean;
  }>;
  totalTimeMinutes: number;
  totalTimeAmount: number;
  totalExpenseAmount: number;
  today: string;
  generatedBy: {
    name: string;
    email: string;
    title: string | null;
  };
}

type MatterWithIncludes = Awaited<ReturnType<typeof loadMatter>>;

async function loadMatter(matterId: string, prisma: PrismaClient) {
  return prisma.matter.findUniqueOrThrow({
    where: { id: matterId },
    include: {
      organization: { include: { offices: { orderBy: { isMain: "desc" } } } },
      contacts: { include: { contact: true }, orderBy: { createdAt: "asc" } },
      timeEntries: { include: { user: true }, orderBy: { date: "asc" } },
      expenses: { include: { user: true }, orderBy: { date: "asc" } },
    },
  });
}

function buildContacts(matter: MatterWithIncludes) {
  return matter.contacts.map((mc) => ({
    name: mc.contact.name,
    role: mc.role,
    roleLabel: labelForMatterRole(mc.role),
    email: mc.contact.email,
    phone: mc.contact.phone,
    address: mc.contact.address,
    personalNumber: mc.contact.personalNumber,
    orgNumber: mc.contact.orgNumber,
    notes: mc.notes,
  }));
}

function buildBilling(matter: MatterWithIncludes) {
  const timeEntries = matter.timeEntries.map((te) => ({
    date: te.date,
    description: te.description,
    minutes: te.minutes,
    hours: `${(te.minutes / 60).toFixed(1).replace(".", ",")} tim`,
    amount: Math.round((te.minutes / 60) * te.hourlyRate),
    userName: te.user.name,
    billable: te.billable,
  }));
  const expenses = matter.expenses.map((e) => ({
    date: e.date,
    description: e.description,
    amount: e.amount,
    userName: e.user.name,
    billable: e.billable,
  }));
  const totalTimeMinutes = timeEntries.reduce((sum, te) => sum + te.minutes, 0);
  const totalTimeAmount = timeEntries.filter((te) => te.billable).reduce((sum, te) => sum + te.amount, 0);
  const totalExpenseAmount = expenses.filter((e) => e.billable).reduce((sum, e) => sum + e.amount, 0);
  return { timeEntries, expenses, totalTimeMinutes, totalTimeAmount, totalExpenseAmount };
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'buildOrganization' has a complexity of 10. Maximum allowed is 8.)
async function buildOrganization(matter: MatterWithIncludes) {
  let logoBase64: string | null = null;
  const logoPath = matter.organization.logoPath;
  if (logoPath && existsSync(logoPath)) {
    try {
      const logoBuffer = await readFile(logoPath);
      const ext = logoPath.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
      logoBase64 = `data:${mime};base64,${logoBuffer.toString("base64")}`;
    } catch {
      // Logo unreadable — continue without it
    }
  }

  const offices = matter.organization.offices.map((o) => ({
    id: o.id,
    name: o.name,
    address: o.address,
    phone: o.phone,
    email: o.email,
    isMain: o.isMain,
  }));
  const mainOffice = offices.find((o) => o.isMain) ?? offices[0] ?? null;
  return { logoBase64, offices, mainOffice };
}

export async function buildTemplateContext(
  matterId: string,
  userId: string,
  prisma: PrismaClient
): Promise<TemplateContext> {
  const [matter, user] = await Promise.all([
    loadMatter(matterId, prisma),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);

  const contacts = buildContacts(matter);
  const klient = contacts.find((c) => c.role === "KLIENT") ?? null;
  const motpart = contacts.find((c) => c.role === "MOTPART") ?? null;

  const billing = buildBilling(matter);
  const { timeEntries, expenses, totalTimeMinutes, totalTimeAmount, totalExpenseAmount } = billing;

  const { logoBase64, offices, mainOffice } = await buildOrganization(matter);

  return {
    matter: {
      id: matter.id,
      matterNumber: matter.matterNumber,
      title: matter.title,
      description: matter.description,
      status: matter.status,
      matterType: matter.matterType,
      createdAt: matter.createdAt,
    },
    organization: {
      name: matter.organization.name,
      address: matter.organization.address,
      phone: matter.organization.phone,
      email: matter.organization.email,
      orgNumber: matter.organization.orgNumber,
      bankgiro: matter.organization.bankgiro,
      logoBase64,
      hasLogo: logoBase64 !== null,
      offices,
      mainOffice,
    },
    contacts,
    klient,
    motpart,
    recipient: null,
    recipients: [],
    timeEntries,
    expenses,
    totalTimeMinutes,
    totalTimeAmount,
    totalExpenseAmount,
    today: new Date().toLocaleDateString("sv-SE"),
    generatedBy: {
      name: user.name,
      email: user.email,
      title: user.title,
    },
  };
}

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  const compiled = Handlebars.compile(templateContent, { noEscape: false });
  const body = compiled(context);

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #000;
    padding: 2.5cm 2.5cm 2.5cm 3cm;
    max-width: 21cm;
    margin: 0 auto;
  }
  h1 { font-size: 18pt; margin-bottom: 0.8em; }
  h2 { font-size: 14pt; margin: 1.2em 0 0.6em; }
  h3 { font-size: 12pt; margin: 1em 0 0.4em; }
  p { margin-bottom: 0.8em; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 11pt; }
  th { background: #f0f0f0; text-align: left; padding: 6px 8px; border-bottom: 2px solid #333; }
  td { padding: 5px 8px; border-bottom: 1px solid #ddd; }
  ul, ol { margin: 0.5em 0 0.8em 1.5em; }
  li { margin-bottom: 0.3em; }
  .signature-block { margin-top: 3em; }
  .signature-line { border-top: 1px solid #000; width: 60%; margin-top: 2em; padding-top: 0.3em; font-size: 10pt; }
  @media print {
    body { padding: 0; }
    @page { margin: 2.5cm 2.5cm 2.5cm 3cm; size: A4; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
