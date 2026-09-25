"use client";

/**
 * Bokför fakturan och dess inbetalningar i byråns bokföringssystem (Fortnox,
 * #1172/#1173). Knappen syns när servern har en ansluten integration och det
 * finns något obokfört; allt bokfört visas med sitt verifikat.
 */

import { useBookInvoice, useLedgerStatus } from "@/lib/client/backend/server-ledger";
import { trpc } from "@/lib/client/trpc";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";

const NOT_BOOKABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(["DRAFT", "CANCELLED"]);

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  fortnoxId: string | null | undefined;
  payments: ReadonlyArray<{ fortnoxId?: string | null | undefined }>;
}

/** Knapptext: hela fakturan, eller bara de nya betalningarna. */
function buttonLabel(invoiceBooked: boolean, pending: number): string {
  if (!invoiceBooked) return "Bokför i Fortnox";
  return pending === 1 ? "Bokför 1 betalning i Fortnox" : `Bokför ${pending} betalningar i Fortnox`;
}

function BookedLine({ fortnoxId, bookedPayments }: { fortnoxId: string; bookedPayments: number }) {
  return (
    <p className="mt-3 text-sm text-green-700">
      ✓ Bokförd i Fortnox (verifikat {fortnoxId}){bookedPayments > 0 && ` · ${bookedPayments} betalning${bookedPayments === 1 ? "" : "ar"} bokförd${bookedPayments === 1 ? "" : "a"}`}
    </p>
  );
}

/** Finns något att bokföra, och får fakturan bokföras? */
function shouldOfferBooking(connected: boolean, status: InvoiceStatus, invoiceBooked: boolean, pending: number): boolean {
  return connected && !NOT_BOOKABLE.has(status) && (!invoiceBooked || pending > 0);
}

export function LedgerBooking({ invoiceId, status, fortnoxId, payments }: Props) {
  const utils = trpc.useUtils();
  const ledger = useLedgerStatus();
  // Även vid fel: fakturan kan vara bokförd fast en betalning fastnade.
  const book = useBookInvoice(asId<"InvoiceId">(invoiceId), () => { void utils.invoice.getById.invalidate({ id: invoiceId }); });
  const pending = payments.filter((p) => !p.fortnoxId).length;
  const canBook = shouldOfferBooking(ledger.data?.connected === true, status, !!fortnoxId, pending);

  return (
    <>
      {fortnoxId && <BookedLine fortnoxId={fortnoxId} bookedPayments={payments.length - pending} />}
      {canBook && (
        <div className="mt-3">
          <button
            type="button"
            disabled={book.isPending}
            onClick={() => book.mutate()}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {book.isPending ? "Bokför…" : buttonLabel(!!fortnoxId, pending)}
          </button>
          {book.error && <p role="alert" className="mt-2 text-sm text-red-700">Kunde inte bokföra: {book.error.message}</p>}
        </div>
      )}
    </>
  );
}
