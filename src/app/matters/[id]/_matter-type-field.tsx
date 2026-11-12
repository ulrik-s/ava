"use client";

/**
 * Ärendetypen i ärendehuvudet (#1521): fetstil på klientraden och
 * inline-redigerbar som målnumret. Byråns ärendetyper
 * (`organization.getSettings` → `matterTypes`) föreslås, men fritext tillåts
 * och läggs inte till i byråns lista.
 */

import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { MatterReferenceField } from "./_matter-reference-field";

export function MatterTypeField({ matterId, value }: { matterId: MatterId; value: string }) {
  const settings = trpc.organization.getSettings.useQuery();
  return (
    <MatterReferenceField matterId={matterId} field="matterType" value={value} variant="emphasis"
      suggestions={settings.data?.matterTypes ?? []} label="Ärendetyp" placeholder="Ärendetyp"
      saveLabel="Spara ärendetyp" />
  );
}
