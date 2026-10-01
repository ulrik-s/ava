"use client";

/**
 * Jävskontrollens åtgärder i ärendet (#1246, #1354): kör kontrollen igen och
 * bedöm träffarna. Bedömningen kräver en motivering och görs av en advokat
 * eller admin — en assistent ser varför knappen saknas. Båda går via
 * procedurkön; offline väntar kontrollen tills servern kört den mot byråns
 * alla ärenden.
 */

import Link from "next/link";
import { useId, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { mayReviewConflicts } from "@/lib/shared/conflict-roles";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

const SECONDARY = "px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50";
const PRIMARY = "px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50";

/** Invalidera allt som visar kontrollen: ärendet och Att bevaka. */
function useRefresh(matterId: MatterId): () => void {
  const utils = trpc.useUtils();
  return () => {
    void utils.watchlist.list.invalidate();
    void utils.matter.getById.invalidate({ id: matterId });
  };
}

export function ConflictCheckActions({ matterId, hasHits }: { matterId: MatterId; hasHits: boolean }) {
  const refresh = useRefresh(matterId);
  const recheck = trpc.matter.checkConflicts.useMutation({ onSuccess: refresh });
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={recheck.isPending} onClick={() => recheck.mutate({ id: matterId })} className={SECONDARY}>
          Kör jävskontrollen igen
        </button>
        {hasHits && (
          <Link href="/conflicts" className="text-sm text-blue-600 hover:underline">Se träffarna i jävskontrollens historik</Link>
        )}
      </div>
      {hasHits && <ReviewHits matterId={matterId} onDone={refresh} />}
    </div>
  );
}

/** Bedömningen: bara för advokat och admin. */
function ReviewHits({ matterId, onDone }: { matterId: MatterId; onDone: () => void }) {
  const me = trpc.user.current.useQuery();
  const [open, setOpen] = useState(false);
  if (!me.data) return null;
  const role = userRoleSchema.safeParse(me.data.role);
  if (!role.success || !mayReviewConflicts(role.data)) {
    return <p className="text-sm text-gray-500">Bara en advokat eller admin kan bedöma träffarna.</p>;
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={PRIMARY}>Bedöm träffarna</button>;
  }
  return <ReviewForm matterId={matterId} onDone={onDone} onCancel={() => setOpen(false)} />;
}

/** Motiveringen krävs — den sparas med vem och när. */
function ReviewForm({ matterId, onDone, onCancel }: { matterId: MatterId; onDone: () => void; onCancel: () => void }) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const reviewed = trpc.matter.markConflictsReviewed.useMutation({ onSuccess: onDone });
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    reviewed.mutate({ id: matterId, note: note.trim() });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={noteId} className="block text-xs font-medium text-gray-500">Motivering</label>
      <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={3}
        placeholder="t.ex. Samma namn men annan person (annat personnummer); ingen intressekonflikt."
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      {reviewed.error && <p role="alert" className="text-sm text-red-600">{reviewed.error.message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!note.trim() || reviewed.isPending} className={PRIMARY}>Spara bedömning</button>
        <button type="button" onClick={onCancel} className={SECONDARY}>Avbryt</button>
      </div>
    </form>
  );
}
