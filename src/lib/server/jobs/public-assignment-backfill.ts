/**
 * Offentligt uppdrag, engångsuppdatering av byråns lista (#1640) — körs när
 * servern startat.
 *
 * En byrå som aldrig har satt markeringen (#1638; `publicAssignmentMatterTypes`
 * saknas/`null`) får de fyra vanliga typerna för offentligt uppdrag i sina
 * ärendetyper, och alla fyra markerade. När fältet väl är satt (även till en
 * tom lista) körs det aldrig igen, så en typ som byrån tagit bort eller kryssat
 * ur läggs inte tillbaka. Jobbet ändrar inga ärenden och skriver inga
 * tjänsteanteckningar: ärendena byts när en admin sparar ärendetyperna
 * (`organization.updateSettings`).
 *
 * Förebild: `document-kinds-backfill.ts` (ADR 0038). Skrivningen går via
 * repona, som loggar i `change_log` → klienterna hämtar byrån vid nästa pull
 * (ADR 0017). Idempotent; fel loggas per byrå och stoppar inte starten.
 */

import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { Organization } from "@/lib/shared/schemas/organization";
import type { OrganizationRepository } from "../repositories/organization-repository";

/** Ärendetyperna som markeras som offentligt uppdrag första gången. */
export const DEFAULT_PUBLIC_ASSIGNMENT_TYPES: readonly string[] = [
  "Offentlig försvarare", "Målsägandebiträde", "Förvaltarskap", "Särskild företrädare",
];

export interface PublicAssignmentBackfillDeps {
  organizations: Pick<OrganizationRepository, "getById" | "update">;
}

export interface PublicAssignmentBackfillResult {
  organizations: number;
  failed: number;
}

const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase("sv") === b.toLocaleLowerCase("sv");

/**
 * Byråns ärendetyper med de fyra standardtyperna tillagda om de saknas, och
 * markeringen. En befintlig typ med annat skiftläge behåller byråns stavning.
 */
export function withDefaultPublicAssignmentTypes(
  matterTypes: readonly string[],
): Pick<Organization, "matterTypes" | "publicAssignmentMatterTypes"> {
  const types = [...matterTypes];
  const marked: string[] = [];
  for (const name of DEFAULT_PUBLIC_ASSIGNMENT_TYPES) {
    const existing = types.find((t) => sameName(t, name));
    if (!existing) types.push(name);
    marked.push(existing ?? name);
  }
  return { matterTypes: types, publicAssignmentMatterTypes: marked };
}

/** En byrå: markeringen sätts bara om den aldrig har satts. */
async function backfillOrganization(deps: PublicAssignmentBackfillDeps, id: OrganizationId): Promise<boolean> {
  const org = await deps.organizations.getById(id);
  if (!org || org.publicAssignmentMatterTypes != null) return false;
  await deps.organizations.update(id, withDefaultPublicAssignmentTypes(org.matterTypes));
  return true;
}

/** Sätt standardmarkeringen hos byråer som aldrig har satt den. Kastar aldrig. */
export async function backfillPublicAssignmentTypes(
  deps: PublicAssignmentBackfillDeps, organizationIds: readonly OrganizationId[], onError: (message: string) => void,
): Promise<PublicAssignmentBackfillResult> {
  const result: PublicAssignmentBackfillResult = { organizations: 0, failed: 0 };
  for (const id of organizationIds) {
    try {
      if (await backfillOrganization(deps, id)) result.organizations++;
    } catch (err) {
      result.failed++;
      onError(`byrå ${id}: ${String(err)}`);
    }
  }
  return result;
}
