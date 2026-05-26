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

// eslint-disable-next-line complexity
export function buildTemplateContext(input: BuildTemplateContextInput): Record<string, unknown> {
  const now = input.now ?? new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return {
    today,
    matter: {
      matterNumber: input.matter.matterNumber,
      title: input.matter.title,
      matterType: input.matter.matterType ?? "",
    },
    recipient: input.recipient
      ? {
          name: input.recipient.name,
          email: input.recipient.email ?? "",
          phone: input.recipient.phone ?? "",
          personalNumber: input.recipient.personalNumber ?? "",
          orgNumber: input.recipient.orgNumber ?? "",
        }
      : null,
    client: input.client
      ? { name: input.client.name, email: input.client.email ?? "", phone: input.client.phone ?? "" }
      : null,
    organization: {
      name: input.organization?.name ?? "",
      orgNumber: input.organization?.orgNumber ?? "",
      address: input.organization?.address ?? "",
      email: input.organization?.email ?? "",
      phone: input.organization?.phone ?? "",
    },
  };
}
