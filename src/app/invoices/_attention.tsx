"use client";

/**
 * Fakturalistans röda markeringar (#1731): "Förfallen N dagar" och "Kom inte
 * fram", och knappen som visar bara de fakturorna. Regeln för förfallen är den
 * delade (`@/lib/shared/invoice-overdue`), samma som "Att bevaka" använder.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/client/trpc";
import { invoiceAttention, type InvoiceAttention, type OverdueCandidate } from "@/lib/shared/invoice-overdue";
import { dagar } from "@/lib/shared/watchlist";

const MARK_CLASS = "text-[10px] rounded-full px-2 py-0.5 font-medium bg-red-100 text-red-700";

/** De röda markeringarna efter statusmärket. En faktura kan ha båda. */
export function AttentionMarks({ attention }: { attention: InvoiceAttention }) {
  return (
    <>
      {attention.overdueDays !== null && (
        <span className={`ml-1 ${MARK_CLASS}`}>Förfallen {dagar(attention.overdueDays)}</span>
      )}
      {attention.failedDispatch && <span className={`ml-1 ${MARK_CLASS}`}>Kom inte fram</span>}
    </>
  );
}

/** Knappen som växlar mellan alla fakturor och bara de med röd markering. */
export function AttentionFilterButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs ${
        active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-600"
      }`}
    >
      Förfallna och ej framkomna
    </button>
  );
}

/** Fakturaraderna med sina markeringar; misslyckade utskick läses ur `invoiceDispatch.listFailed`. */
export function useInvoiceAttention<T extends OverdueCandidate & { id: string }>(
  invoices: readonly T[],
): Array<T & { attention: InvoiceAttention }> {
  const failed = trpc.invoiceDispatch.listFailed.useQuery();
  const failedIds = useMemo(() => new Set((failed.data ?? []).map((d) => String(d.invoiceId))), [failed.data]);
  const now = new Date();
  return invoices.map((inv) => ({ ...inv, attention: invoiceAttention(inv, failedIds, now) }));
}
