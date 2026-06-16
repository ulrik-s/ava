"use client";

interface Props {
  invoiceType: string;
  status: string;
  hasPlan: boolean;
  hasCreditNote: boolean;
  /** Utestående (öre) > 0 → avskrivning möjlig (räkna-en-gång, ADR 0007). */
  outstanding: number;
  onShowPayment: () => void;
  onShowPlan: () => void;
  onShowCredit: () => void;
  onShowWriteOff: () => void;
  onShowSend: () => void;
  onSetStatus: (status: string) => void;
}

interface Visibility {
  pay: boolean;
  plan: boolean;
  draft: boolean;
  cancel: boolean;
  credit: boolean;
  writeOff: boolean;
  send: boolean;
}

const TERMINAL_STATUS: ReadonlySet<string> = new Set(["PAID", "CANCELLED"]);

/**
 * Skicka-knappen (#179/#392): en faktura kan skickas i DRAFT (då blir den SENT),
 * är utställd (SENT/avbetalningsplan → kan skickas om), eller är en icke-annullerad
 * kreditfaktura. Modalen erbjuder automatiskt (köa → server) + manuellt utskick.
 */
function canSend(isCredit: boolean, status: string): boolean {
  if (status === "DRAFT" || status === "SENT" || status === "INSTALLMENT_PLAN") return true;
  return isCredit && status !== "CANCELLED";
}

function computeVisibility(invoiceType: string, status: string, hasPlan: boolean, hasCreditNote: boolean, outstanding: number): Visibility {
  const isCredit = invoiceType === "CREDIT";
  const sentNoPlan = !isCredit && status === "SENT" && !hasPlan;
  // Utställd & aktiv (SENT eller pågående avbetalningsplan, ej kreditfaktura).
  const issuedActive = !isCredit && (status === "SENT" || status === "INSTALLMENT_PLAN");
  return {
    pay: !isCredit && !TERMINAL_STATUS.has(status),
    plan: sentNoPlan,
    draft: status === "DRAFT",
    cancel: sentNoPlan,
    credit: issuedActive && !hasCreditNote,
    // Avskrivning: utställd faktura med utestående kvar (även en plan-faktura
    // som klienten slutat betala) → räkna-en-gång (ADR 0007).
    writeOff: issuedActive && outstanding > 0,
    send: canSend(isCredit, status),
  };
}

export function InvoiceActions({
  invoiceType, status, hasPlan, hasCreditNote, outstanding,
  onShowPayment, onShowPlan, onShowCredit, onShowWriteOff, onShowSend, onSetStatus,
}: Props) {
  const v = computeVisibility(invoiceType, status, hasPlan, hasCreditNote, outstanding);

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
      {v.send && (
        <button onClick={onShowSend} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Skicka faktura
        </button>
      )}
      {v.draft && (
        <button onClick={() => onSetStatus("SENT")} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Markera som skickad
        </button>
      )}
      {v.cancel && (
        <button onClick={() => onSetStatus("CANCELLED")} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Annullera
        </button>
      )}
      {v.writeOff && (
        <button onClick={onShowWriteOff} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50">
          Skriv av som kundförlust
        </button>
      )}
      {v.credit && (
        <button onClick={onShowCredit} className="px-3 py-1.5 text-sm border border-orange-200 text-orange-700 rounded hover:bg-orange-50">
          Kreditera
        </button>
      )}
    </div>
  );
}
