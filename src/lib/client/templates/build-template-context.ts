/**
 * `buildTemplateContext` — bygger Handlebars-context för dokumentmall-
 * generering på klienten (demo/static-export har ingen /api/-route).
 *
 * Mallar refererar fält som {{matter.matterNumber}}, {{recipient.name}},
 * {{organization.name}}, {{today}}. Vi exponerar en stabil shape så
 * befintliga seed-mallar fungerar utan ändring.
 */

export interface TemplateMatter {
  matterNumber: string;
  title: string;
  matterType?: string | null;
}

export interface TemplateContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  personalNumber?: string | null;
  orgNumber?: string | null;
}

export interface TemplateOrganization {
  name?: string | null;
  orgNumber?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BuildTemplateContextInput {
  matter: TemplateMatter;
  /** Mottagare (vald kontakt) — null för generellt dokument. */
  recipient?: TemplateContact | null;
  organization?: TemplateOrganization | null;
  /** Klient på ärendet (KLIENT-rollen) — alltid tillgänglig i mallen. */
  client?: TemplateContact | null;
  /** Override:bar "idag" för deterministiska tester. */
  now?: Date;
}

/** `YYYY-MM-DD` lokalt — stabil shape som seed-mallar förväntar sig. */
function formatToday(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function buildMatter(matter: TemplateMatter): Record<string, unknown> {
  return {
    matterNumber: matter.matterNumber,
    title: matter.title,
    matterType: matter.matterType ?? "",
  };
}

/** Mottagare/klient: `null` (ej tomt objekt) när kontakten saknas. */
function buildRecipient(recipient: TemplateContact | null | undefined): Record<string, unknown> | null {
  if (!recipient) return null;
  return {
    name: recipient.name,
    email: recipient.email ?? "",
    phone: recipient.phone ?? "",
    personalNumber: recipient.personalNumber ?? "",
    orgNumber: recipient.orgNumber ?? "",
  };
}

function buildClient(client: TemplateContact | null | undefined): Record<string, unknown> | null {
  if (!client) return null;
  return { name: client.name, email: client.email ?? "", phone: client.phone ?? "" };
}

function buildOrganization(organization: TemplateOrganization | null | undefined): Record<string, unknown> {
  const org: TemplateOrganization = organization ?? {};
  return {
    name: org.name ?? "",
    orgNumber: org.orgNumber ?? "",
    address: org.address ?? "",
    email: org.email ?? "",
    phone: org.phone ?? "",
  };
}

export function buildTemplateContext(input: BuildTemplateContextInput): Record<string, unknown> {
  const now = input.now ?? new Date();
  return {
    today: formatToday(now),
    matter: buildMatter(input.matter),
    recipient: buildRecipient(input.recipient),
    client: buildClient(input.client),
    organization: buildOrganization(input.organization),
  };
}
