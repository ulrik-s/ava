/**
 * Byråns fält på fakturadokumentet (#1439): namn, org.nr och logga ur
 * organisationsinställningarna. EN mappning för alla fakturaflöden, så att
 * loggan inte faller bort i något av dem.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { OrgImage } from "@/lib/shared/org-image";
import type { FakturaDocMeta } from "./faktura-template";

/** Delmängden av organisationsinställningarna som fakturan visar. */
export interface FakturaOrgSettings {
  name?: string | null | undefined;
  orgNumber?: string | null | undefined;
  logo?: OrgImage | null | undefined;
}

/** Byråfälten i fakturans metadata. */
export type FakturaOrgMeta = Pick<FakturaDocMeta, "organizationName" | "organizationOrgNumber" | "organizationLogo">;

/** Organisationsinställningarna → fakturans byråfält; tomma fält utelämnas. */
export function fakturaOrgMeta(org: FakturaOrgSettings | null | undefined): FakturaOrgMeta {
  return omitUndefined({
    organizationName: org?.name || undefined,
    organizationOrgNumber: org?.orgNumber || undefined,
    organizationLogo: org?.logo ?? undefined,
  });
}
