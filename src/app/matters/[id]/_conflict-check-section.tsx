"use client";

/**
 * Jävskontrollen i ärendets flik Parter (#1733): kontrollen gäller parterna och
 * körs om när en part läggs till, så den står där parten läggs till. Statusen
 * läses från ärendet självt med samma regel och texter som Att bevaka
 * (`conflictCheckItems`), åtgärderna och senaste bedömningen är samma
 * komponenter som förut. En klar kontroll utan träffar visar ingen status.
 */

import { ConflictCheckActions } from "@/components/watchlist/conflict-check-actions";
import { ConflictReviewInfo } from "@/components/watchlist/conflict-review-info";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { conflictCheckItems, type WatchlistItem } from "@/lib/shared/watchlist";

/** Ärendets fält som regeln läser (`exactOptionalPropertyTypes`: saknas → null). */
interface MatterConflictFields {
  id: string;
  matterNumber: string;
  status?: string | null | undefined;
  conflictCheckStatus?: string | null | undefined;
  conflictCheckHits?: number | null | undefined;
}

/** Jävskontrollens post för ärendet, eller undefined (klar utan träffar, stängt ärende). */
function conflictItemOf(m: MatterConflictFields | undefined): WatchlistItem | undefined {
  if (!m) return undefined;
  return conflictCheckItems([{
    id: m.id, matterNumber: m.matterNumber, status: m.status ?? null,
    conflictCheckStatus: m.conflictCheckStatus ?? null, conflictCheckHits: m.conflictCheckHits ?? null,
  }])[0];
}

export function ConflictCheckSection({ matterId }: { matterId: MatterId }) {
  const matter = trpc.matter.getById.useQuery({ id: matterId });
  const item = conflictItemOf(matter.data);
  return (
    <>
      {item && (
        <div aria-label="Jävskontroll" role="group" className="px-2 py-3 border-t border-gray-100">
          <WatchlistList items={[item]} emptyText="" />
          {/* Träffar = passerad; en kontroll som väntar = annalkande (#1246). */}
          <ConflictCheckActions matterId={matterId} hasHits={item.severity === "passed"} />
        </div>
      )}
      <ConflictReviewInfo matterId={matterId} />
    </>
  );
}
