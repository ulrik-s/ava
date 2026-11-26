/**
 * `buildTemplateContext` — bygger Handlebars-context för dokumentmall-
 * generering på klienten (demo/static-export har ingen /api/-route).
 *
 * Mallar refererar fält som {{matter.matterNumber}}, {{recipient.name}},
 * {{organization.name}}, {{today}}. Kontexten byggs direkt ur frågornas data
 * (`matter.getById`, `organization.getSettings`, `organization.listOffices`,
 * `user.current`) och den valda mottagarens kontakt-id (#2118), så att alla
 * variabler i mallredigerarens lista fylls i när uppgiften finns. Anteckningar
 * (kopplingens och kontaktens) tas aldrig med.
 */

import { linkToRecipientData, resolveRecipients, type MatterContactLink, type RecipientContactData } from "@/lib/client/template-recipients";
import { toIsoDate } from "@/lib/shared/iso-date";
import { MATTER_STATUS_LABELS, type MatterStatus } from "@/lib/shared/schemas/enums";
import type { ContactId, MatterId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";

/** Det ur `matter.getById` som mallen läser. */
export interface TemplateMatterData {
  id: MatterId;
  matterNumber: string;
  title: string;
  matterType?: string | null | undefined;
  description?: string | null | undefined;
  status: MatterStatus;
  createdAt: Date | string;
  contacts: readonly MatterContactLink[];
}

/** Det ur `organization.getSettings` som mallen läser. */
export interface TemplateOrganizationData {
  name?: string | null | undefined;
  orgNumber?: string | null | undefined;
  address?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  bankgiro?: string | null | undefined;
}

/** Ett kontor ur `organization.listOffices`. */
export interface TemplateOfficeData {
  name: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  isMain?: boolean | undefined;
}

/** Den inloggade ur `user.current`. */
export interface TemplateUserData {
  name: string;
  title?: string | null | undefined;
}

export interface BuildTemplateContextInput {
  matter: TemplateMatterData;
  organization?: TemplateOrganizationData | null | undefined;
  offices?: readonly TemplateOfficeData[] | undefined;
  user?: TemplateUserData | null | undefined;
  /** Mottagarens kontakt-id — null för ett generellt dokument. */
  recipientId?: ContactId | null | undefined;
  /** Override:bar "idag" för deterministiska tester. */
  now?: Date;
}

/** Mottagaren i mallen: kontaktens uppgifter och rollens etikett (utan anteckningar och rollkod). */
export interface TemplateRecipient {
  name: string;
  email: string;
  phone: string;
  address: string;
  personalNumber: string;
  orgNumber: string;
  roleLabel: string;
}

/** Klienten i mallen (`klient`, med `client` som alias). */
export interface TemplateClient {
  name: string;
  personalNumber: string;
  address: string;
  phone: string;
  email: string;
}

/** Mallens kontext, med tomma strängar eller `null` där uppgiften saknas. */
export type TemplateContext = {
  today: string;
  matter: { matterNumber: string; title: string; matterType: string; description: string; status: string; createdAt: string };
  recipient: TemplateRecipient | null;
  klient: TemplateClient | null;
  /** Alias för `klient`: sparade mallar med `{{client.name}}` fungerar som förut. */
  client: TemplateClient | null;
  motpart: { name: string } | null;
  contacts: Array<{ name: string; roleLabel: string }>;
  organization: {
    name: string; orgNumber: string; address: string; email: string; phone: string; bankgiro: string;
    mainOffice: { name: string; address: string } | null;
    offices: Array<{ name: string; address: string; phone: string }>;
  };
  generatedBy: { name: string; title: string } | null;
};

const text = (v: string | null | undefined): string => v ?? "";

function buildMatter(matter: TemplateMatterData): TemplateContext["matter"] {
  return {
    matterNumber: matter.matterNumber,
    title: matter.title,
    matterType: text(matter.matterType),
    description: text(matter.description),
    status: MATTER_STATUS_LABELS[matter.status],
    createdAt: toIsoDate(matter.createdAt),
  };
}

/** Mottagaren: `null` (ej tomt objekt) när ingen är vald. */
function buildRecipient(matter: TemplateMatterData, recipientId: ContactId | null | undefined): TemplateRecipient | null {
  if (!recipientId) return null;
  const [resolved] = resolveRecipients([recipientId], matter.contacts, matter.id);
  return resolved ? recipientOf(resolved.data) : null;
}

function recipientOf(d: RecipientContactData): TemplateRecipient {
  return {
    name: d.name, email: text(d.email), phone: text(d.phone), address: text(d.address),
    personalNumber: text(d.personalNumber), orgNumber: text(d.orgNumber), roleLabel: d.roleLabel,
  };
}

/** Den första parten med rollen, eller undefined. */
function firstWithRole(matter: TemplateMatterData, role: string): MatterContactLink | undefined {
  return matter.contacts.find((c) => c.role === role);
}

function buildClient(link: MatterContactLink | undefined): TemplateClient | null {
  if (!link) return null;
  const d = linkToRecipientData(link);
  return { name: d.name, personalNumber: text(d.personalNumber), address: text(d.address), phone: text(d.phone), email: text(d.email) };
}

function buildOrganization(org: TemplateOrganizationData, offices: readonly TemplateOfficeData[]): TemplateContext["organization"] {
  const main = offices.find((o) => o.isMain);
  return {
    name: text(org.name),
    orgNumber: text(org.orgNumber),
    address: text(org.address),
    email: text(org.email),
    phone: text(org.phone),
    bankgiro: text(org.bankgiro),
    mainOffice: main ? { name: main.name, address: text(main.address) } : null,
    offices: offices.map((o) => ({ name: o.name, address: text(o.address), phone: text(o.phone) })),
  };
}

export function buildTemplateContext(input: BuildTemplateContextInput): TemplateContext {
  const now = input.now ?? new Date();
  const { matter } = input;
  const klient = buildClient(firstWithRole(matter, "KLIENT"));
  const motpart = firstWithRole(matter, "MOTPART");
  return {
    today: stockholmDay(now), // `YYYY-MM-DD` i svensk tid — stabil shape för seed-mallarna (#1677)
    matter: buildMatter(matter),
    recipient: buildRecipient(matter, input.recipientId),
    klient,
    client: klient,
    motpart: motpart ? { name: motpart.contact.name } : null,
    contacts: matter.contacts.map((c) => {
      const d = linkToRecipientData(c);
      return { name: d.name, roleLabel: d.roleLabel };
    }),
    organization: buildOrganization(input.organization ?? {}, input.offices ?? []),
    generatedBy: input.user ? { name: input.user.name, title: text(input.user.title) } : null,
  };
}
