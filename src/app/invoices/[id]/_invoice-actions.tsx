"use client";

interface Props {
  invoiceType: string;
  status: string;
  hasPlan: boolean;
  hasCreditNote: boolean;
  onShowPayment: () => void;
  onShowPlan: () => void;
  onShowCredit: () => void;
  onSetStatus: (status: string) => void;
}

interface Visibility {
  pay: boolean;
  plan: boolean;
  draft: boolean;
  cancel: boolean;
  credit: boolean;
}

function computeVisibility(invoiceType: string, status: string, hasPlan: boolean, hasCreditNote: boolean): Visibility {
  const isCredit = invoiceType === "CREDIT";
  const sentNoPlan = !isCredit && status === "SENT" && !hasPlan;
  return {
    pay: !isCredit && status !== "PAID" && status !== "CANCELLED",
    plan: sentNoPlan,
    draft: status === "DRAFT",
    cancel: sentNoPlan,
    credit: (status === "SENT" || status === "INSTALLMENT_PLAN") && !isCredit && !hasCreditNote,
  };
}

export function InvoiceActions({
  invoiceType, status, hasPlan, hasCreditNote,
  onShowPayment, onShowPlan, onShowCredit, onSetStatus,
}: Props) {
  const v = computeVisibility(invoiceType, status, hasPlan, hasCreditNote);

  return (
    <div className="mt-5 flex gap-2 flex-wrap">
      {v.pay && (
        <button onClick={onShowPayment} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
          Registrera betalning
        </button>
      )}
      {v.plan && (
        <button onClick={onShowPlan} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
          Skapa avbetalningsplan
        </button>
      )}
      {v.draft && (
        <button onClick={() => onSetStatus("SENT")} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Markera som skickad
        </button>
      )}
      {v.cancel && (
        <>
          <button onClick={() => onSetStatus("CANCELLED")} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Annullera
          </button>
          <button onClick={() => onSetStatus("BAD_DEBT")} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50">
            Skriv av som kundförlust
          </button>
        </>
      )}
      {v.credit && (
        <button onClick={onShowCredit} className="px-3 py-1.5 text-sm border border-orange-200 text-orange-700 rounded hover:bg-orange-50">
          Kreditera
        </button>
      )}
    </div>
  );
}
