"use client";

/**
 * Flytta markerade tidsposter till ett annat ärende (#2043). Delas av /time och
 * ärendets tidslista: knappen **Flytta till ärende… (N)** ovanför tabellen och
 * `MoveToMatterDialog`, som anropar `timeEntry.moveToMatter` (#2042).
 */

import { useState } from "react";
import { MoveToMatterDialog } from "@/components/matter/move-to-matter-dialog";
import type { RowSelection } from "@/components/ui/data-table";
import { trpc } from "@/lib/client/trpc";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { isLockedEntry, type LockableEntry } from "@/lib/shared/time-entry-lock";
import { useActiveMatterOptions } from "./use-save-time-entry";

/** Låsta poster (fakturerade eller frysta) går inte att markera, samma regel som i routern. */
export function isMovableEntry(entry: LockableEntry): boolean {
  return !isLockedEntry(entry);
}

/** Tidslistans markering: tabellens `selection` och en tömning efter flytten. */
export function useTimeEntrySelection<T extends LockableEntry>(): {
  selection: RowSelection<T>;
  clear: () => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  return {
    selection: { selected, onChange: setSelected, isSelectable: isMovableEntry },
    clear: () => setSelected(new Set()),
  };
}

interface Props {
  /** De markerade postnas id. */
  selected: ReadonlySet<string>;
  /** Ärendet listan visar: inte valbart (ärendesidan). */
  excludeMatterId?: MatterId | undefined;
  /** Läs om det som visar posterna, med målärendet. */
  refresh: (toMatterId: MatterId) => void;
  /** Flytten gick igenom: töm markeringen. */
  onMoved: () => void;
}

/** **Flytta till ärende… (N)** när minst en post är markerad, och dialogen den öppnar. */
export function MoveTimeEntriesButton({ selected, excludeMatterId, refresh, onMoved }: Props) {
  const [open, setOpen] = useState(false);
  const matters = useActiveMatterOptions();
  const move = trpc.timeEntry.moveToMatter.useMutation({
    onError: (e) => console.error("[timeEntry.moveToMatter] misslyckades:", e),
  });
  if (selected.size === 0) return null;
  const onMove = (matterId: MatterId): void => {
    const ids = [...selected].map((id) => asId<"TimeEntryId">(id));
    move.mutate({ ids, matterId }, {
      onSuccess: () => { refresh(matterId); onMoved(); setOpen(false); },
    });
  };
  return (
    <div className="mb-2 flex justify-end">
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs px-3 py-1 border border-blue-300 rounded hover:bg-blue-50 text-blue-700">
        Flytta till ärende… ({selected.size})
      </button>
      <MoveToMatterDialog open={open} onClose={() => setOpen(false)} count={selected.size} noun="tidsposter"
        matters={matters} excludeMatterId={excludeMatterId} onMove={onMove}
        isPending={move.isPending} error={move.error?.message} />
    </div>
  );
}
