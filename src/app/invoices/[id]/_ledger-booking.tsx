"use client";

/**
 * Bokför fakturan i byråns bokföringssystem (Fortnox, #1172). Syns bara när
 * servern har en ansluten integration; en bokförd faktura visar verifikatet.
 */

import { trpc } from "@/lib/client/trpc";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

const NOT_BOOKABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(["DRAFT", "CANCELLED"]);

export function LedgerBooking({ invoiceId, status, fortnoxId }: {
  invoiceId: string; status: InvoiceStatus; fortnoxId: string | null | undefined;
}) {
  const utils = trpc.useUtils();
  const ledger = trpc.ledger.status.useQuery();
  const book = trpc.ledger.bookInvoice.useMutation({
    onSuccess: () => { void utils.invoice.getById.invalidate({ id: invoiceId }); },
  });

  if (fortnoxId) {
    return <p className="mt-3 text-sm text-green-700">✓ Bokförd i Fortnox (verifikat {fortnoxId})</p>;
  }
  if (!ledger.data?.connected || NOT_BOOKABLE.has(status)) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={book.isPending}
        onClick={() => book.mutate({ invoiceId: asId<"InvoiceId">(invoiceId) })}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
      >
        {book.isPending ? "Bokför…" : "Bokför i Fortnox"}
      </button>
      {book.error && <p role="alert" className="mt-2 text-sm text-red-700">Kunde inte bokföra: {book.error.message}</p>}
    </div>
  );
}
