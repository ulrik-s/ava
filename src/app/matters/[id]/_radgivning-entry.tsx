"use client";

/**
 * "Markera som rådgivning" (#1207) — UI-sidan av rådgivningspostens regel.
 *
 * Rättshjälpsärenden vars rådgivningsfaktura skapades före #1205 saknar den
 * låsta rådgivningsposten. Juristen pekar ut mötet i tidslistan; fakturapanelen
 * varnar så länge posten saknas. Båda läser `timeEntry.radgivningStatus` —
 * samma predikat som servern avgör markeringen med.
 */

import { trpc } from "@/lib/client/trpc";
import { entryMarkBlocker, needsRadgivningEntry, type MarkableEntry } from "@/lib/shared/radgivning-entry";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";

/** Bekräftelsetexten — vad markeringen gör, innan den görs. */
export const MARK_RADGIVNING_CONFIRM =
  "Markera tidsposten som rådgivningstimmen?\n\n" +
  "Posten låses mot rådgivningsfakturan och yrkas inte i kostnadsräkningen eller slutregleringen. " +
  "En post över 60 minuter delas: 60 minuter låses och resten blir kvar som vanlig tid. " +
  "Markeringen kan inte ångras.";

/** Ärendets rådgivningsstatus; frågas bara i rättshjälpsärenden. */
function useNeedsRadgivningEntry(matterId: MatterId, paymentMethod: PaymentMethod | null | undefined): boolean {
  const status = trpc.timeEntry.radgivningStatus.useQuery({ matterId }, { enabled: paymentMethod === "RATTSHJALP" }).data;
  return status !== undefined && needsRadgivningEntry(status);
}

/** Det tidslistan behöver: får raden markeras, och markera (efter bekräftelse). */
export interface MarkRadgivning {
  canMark: (entry: MarkableEntry) => boolean;
  mark: (id: TimeEntryId) => void;
}

export function useMarkRadgivning(matterId: MatterId, paymentMethod: PaymentMethod | null | undefined): MarkRadgivning {
  const utils = trpc.useUtils();
  const needed = useNeedsRadgivningEntry(matterId, paymentMethod);
  const markMutation = trpc.timeEntry.markAsRadgivning.useMutation({
    onSuccess: () => { void utils.timeEntry.invalidate(); void utils.billingRun.invalidate(); },
    onError: (e) => { console.error("[timeEntry.markAsRadgivning] misslyckades:", e); alert(`Kunde inte markera: ${e.message}`); },
  });
  return {
    canMark: (entry) => needed && entryMarkBlocker(entry) === null,
    mark: (id) => { if (confirm(MARK_RADGIVNING_CONFIRM)) markMutation.mutate({ id }); },
  };
}

/** Fakturapanelens varning: rådgivningsfakturan finns men ingen låst post. Self-gating. */
export function RadgivningEntryWarning({ matterId, paymentMethod }: { matterId: MatterId; paymentMethod: PaymentMethod | null | undefined }) {
  if (!useNeedsRadgivningEntry(matterId, paymentMethod)) return null;
  return (
    <div role="status" className="mx-6 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Rådgivningsfakturan saknar låst rådgivningspost. Om mötet är registrerat som tid — markera det som rådgivning
      i tidslistan, annars yrkas timmen i kostnadsräkningen.
    </div>
  );
}
