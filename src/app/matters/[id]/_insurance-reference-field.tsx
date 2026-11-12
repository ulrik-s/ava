"use client";

/**
 * Försäkringsbolagets referens på ärendet (#1511). Visas i ärendehuvudet bara
 * när ärendet har ett försäkringsbolag som kontakt som inte är motpart eller
 * motpartsombud (#1532); sökbar i ärendelistan. En sparad referens ligger kvar
 * även när fältet döljs.
 */

import { hasInsuranceCompany, type MatterContactWithRole } from "@/lib/shared/matter-insurance";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { MatterReferenceField } from "./_matter-reference-field";

export function InsuranceReferenceField({ matterId, value, contacts }: {
  matterId: MatterId;
  value: string;
  contacts: readonly MatterContactWithRole[];
}) {
  if (!hasInsuranceCompany(contacts)) return null;
  return (
    <MatterReferenceField matterId={matterId} field="insuranceReference" value={value}
      label="Försäkringsreferens" placeholder="Bolagets referens" saveLabel="Spara försäkringsreferens" />
  );
}
