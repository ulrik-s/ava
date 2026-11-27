"use client";

import { trpc } from "@/lib/client/trpc";
import type { MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";
import { timeEntryInput, type EditForm } from "./time-entry-form";

/** Posten som sparas: dess id, ärendet den ligger i och ärendet som valts i formuläret (#2042). */
export interface SaveTarget {
  id: TimeEntryId;
  fromMatterId: MatterId;
  toMatterId: MatterId;
}

/** Byter posten ärende? Ett tomt val (fältet rensat eller ärendet inte i listan) flyttar inte. */
export function isMove(target: SaveTarget): boolean {
  return target.toMatterId !== "" && target.toMatterId !== target.fromMatterId;
}

/** Vad anroparen gör när sparandet lyckats. */
export interface SaveCallbacks {
  /** Läs om det som visar posterna i de berörda ärendena. */
  refresh: (matterIds: MatterId[]) => void;
  /** Allt är sparat: stäng formuläret. */
  done: () => void;
}

/**
 * Spara i **Ändra tidregistrering** (#2042): först `timeEntry.update` med
 * formulärets fält, och har ett annat ärende valts sedan `timeEntry.moveToMatter`.
 * Formuläret stängs först när båda gått igenom, så att ett fel syns i dialogen.
 * Delas av /time och ärendets tidslista.
 */
export function useSaveTimeEntry({ refresh, done }: SaveCallbacks) {
  // Ett sparande som misslyckas får aldrig vara tyst (#1170) — felet visas i
  // dialogen och loggas i konsolen.
  const update = trpc.timeEntry.update.useMutation({ onError: (e) => console.error("[timeEntry.update] misslyckades:", e) });
  const move = trpc.timeEntry.moveToMatter.useMutation({ onError: (e) => console.error("[timeEntry.moveToMatter] misslyckades:", e) });

  function moveIfChanged(target: SaveTarget): void {
    if (!isMove(target)) { done(); return; }
    move.mutate({ ids: [target.id], matterId: target.toMatterId }, {
      onSuccess: () => { refresh([target.fromMatterId, target.toMatterId]); done(); },
    });
  }

  return {
    save: (target: SaveTarget, form: EditForm): void => {
      update.mutate({ id: target.id, ...timeEntryInput(form) }, {
        onSuccess: () => { refresh([target.fromMatterId]); moveIfChanged(target); },
      });
    },
    isPending: update.isPending || move.isPending,
    error: update.error ?? move.error,
  };
}
