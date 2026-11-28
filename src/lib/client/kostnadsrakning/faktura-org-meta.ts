/**
 * Byråns fält på fakturadokumentet (#1439, #2255): namn, org.nr, logga och
 * sidfotens uppgifter (telefon, webbplats, bankgiro, sigill) ur
 * organisationsinställningarna. EN mappning för alla fakturaflöden, så att
 * inget av dem tappar loggan eller sidfoten — samma fält som kostnadsräkningen
 * läser (#1218).
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { OrgImage } from "@/lib/shared/org-image";
import type { FakturaDocMeta } from "./faktura-template";

/** Delmängden av organisationsinställningarna som fakturan visar. */
export interface FakturaOrgSettings {
  name?: string | null | undefined;
  orgNumber?: string | null | undefined;
  logo?: OrgImage | null | undefined;
  phone?: string | null | undefined;
  website?: string | null | undefined;
  bankgiro?: string | null | undefined;
  footerSeal?: OrgImage | null | undefined;
}

/** Byråfälten i fakturans metadata. */
export type FakturaOrgMeta = Pick<FakturaDocMeta,
  "organizationName" | "organizationOrgNumber" | "organizationLogo"
  | "organizationPhone" | "organizationWebsite" | "organizationBankgiro" | "organizationFooterSeal">;

/** En textinställning: tom eller saknad → utelämnas. */
const text = (v: string | null | undefined): string | undefined => v || undefined;

/** En bildinställning: saknad → utelämnas. */
const image = (v: OrgImage | null | undefined): OrgImage | undefined => v ?? undefined;

/** Organisationsinställningarna → fakturans byråfält; tomma fält utelämnas. */
export function fakturaOrgMeta(org: FakturaOrgSettings | null | undefined): FakturaOrgMeta {
  const o: FakturaOrgSettings = org ?? {};
  return omitUndefined({
    organizationName: text(o.name),
    organizationOrgNumber: text(o.orgNumber),
    organizationLogo: image(o.logo),
    organizationPhone: text(o.phone),
    organizationWebsite: text(o.website),
    organizationBankgiro: text(o.bankgiro),
    organizationFooterSeal: image(o.footerSeal),
  });
}

/** Bara byråfälten ur en metadata som bär fler (t.ex. ärendets). */
export function pickFakturaOrgMeta(meta: FakturaOrgMeta): FakturaOrgMeta {
  return omitUndefined({
    organizationName: meta.organizationName,
    organizationOrgNumber: meta.organizationOrgNumber,
    organizationLogo: meta.organizationLogo,
    organizationPhone: meta.organizationPhone,
    organizationWebsite: meta.organizationWebsite,
    organizationBankgiro: meta.organizationBankgiro,
    organizationFooterSeal: meta.organizationFooterSeal,
  });
}
