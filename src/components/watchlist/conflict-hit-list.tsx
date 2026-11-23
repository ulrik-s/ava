"use client";

/**
 * Jävskontrollens träffar i ärendets flik Parter (#1821): kontakten, rollen i
 * det andra ärendet och det andra ärendet som länk. Träffarna sparas på ärendet
 * av kontrollen (#1819). Ett äldre ärende med träffar att bedöma men utan
 * sparade träffar får en uppmaning att köra kontrollen igen.
 */

import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { MATTER_ROLE_LABELS } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";
import type { ConflictHit } from "@/lib/shared/schemas/misc";

/** Det listan läser ur ärendet. */
interface HitsMatter {
  conflictCheckStatus?: string | null | undefined;
  conflictCheckResults?: readonly ConflictHit[] | null | undefined;
}

/** Statusarna där träffarna visas: att bedöma och bedömda. */
const SHOWS_HITS = new Set(["HITS", "REVIEWED"]);

/** Träffarna som listan visar för ärendet; tom när ingen lista visas. */
function visibleConflictHits(m: HitsMatter | undefined): readonly ConflictHit[] {
  if (!m || !SHOWS_HITS.has(m.conflictCheckStatus ?? "")) return [];
  return m.conflictCheckResults ?? [];
}

/** Träffarna som listan visar, ur den cachade `matter.getById`-frågan. */
export function useVisibleConflictHits(matterId: MatterId): readonly ConflictHit[] {
  const matter = trpc.matter.getById.useQuery({ id: matterId });
  return visibleConflictHits(matter.data);
}

function HitRow({ hit }: { hit: ConflictHit }) {
  return (
    <li className="text-gray-900">
      <span className="font-medium">{hit.contactName}</span>{" "}
      <span className="text-gray-600">({MATTER_ROLE_LABELS[hit.role]})</span>{" i "}
      <EntityLink route="matters" id={hit.matterId} className="text-blue-700 hover:underline">
        {`${hit.matterNumber} — ${hit.matterTitle}`}
      </EntityLink>
    </li>
  );
}

/** Listan; `className` placerar den i gruppen eller ovanför bedömningen. */
export function ConflictHitList({ matterId, className = "mt-2" }: { matterId: MatterId; className?: string }) {
  const matter = trpc.matter.getById.useQuery({ id: matterId });
  const m: HitsMatter | undefined = matter.data;
  if (m?.conflictCheckStatus === "HITS" && !m.conflictCheckResults) {
    return <p className={`${className} text-sm text-gray-600`}>Kör jävskontrollen igen för att se träffarna.</p>;
  }
  const hits = visibleConflictHits(m);
  if (hits.length === 0) return null;
  return (
    <div className={`${className} text-sm`}>
      <p className="font-medium text-gray-700">Träffar i senaste kontrollen</p>
      <ul className="mt-1 space-y-1">
        {hits.map((h) => <HitRow key={`${h.contactId}:${h.matterId}:${h.role}`} hit={h} />)}
      </ul>
    </div>
  );
}
