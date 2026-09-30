"use client";

/**
 * Jävskontrollens åtgärder i ärendet (#1246): kör kontrollen igen (t.ex. när
 * klienten lagts till efter att ärendet skapades) och markera träffarna som
 * bedömda. Båda går via procedurkön — offline väntar kontrollen tills servern
 * kört den mot byråns alla ärenden.
 */

import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";

export function ConflictCheckActions({ matterId, hasHits }: { matterId: MatterId; hasHits: boolean }) {
  const utils = trpc.useUtils();
  const refresh = (): void => {
    void utils.watchlist.list.invalidate();
    void utils.matter.getById.invalidate({ id: matterId });
  };
  const recheck = trpc.matter.checkConflicts.useMutation({ onSuccess: refresh });
  const reviewed = trpc.matter.markConflictsReviewed.useMutation({ onSuccess: refresh });
  const busy = recheck.isPending || reviewed.isPending;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => recheck.mutate({ id: matterId })}
        className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
        Kör jävskontrollen igen
      </button>
      {hasHits && (
        <button type="button" disabled={busy} onClick={() => reviewed.mutate({ id: matterId })}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          Träffarna är bedömda
        </button>
      )}
    </div>
  );
}
