"use client";

import { isLive, isSendable, isTerminal } from "@/lib/shared/billing/invoice-state-machine";
import type { InvoiceStatus, InvoiceType } from "@/lib/shared/schemas/enums";

interface Props {
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  hasPlan: boolean;
  /** Utestående (öre) > 0 → avskrivning möjlig (räkna-en-gång, ADR 0007). */
  outstanding: number;
  onShowPayment: () => void;
  onShowPlan: () => void;
  /** "Fel på fakturan?" (#2260): makulera eller kreditera och gör om. */
  onShowRedo: () => void;
  onShowWriteOff: () => void;
  onShowSend: () => void;
  onSetStatus: (status: InvoiceStatus) => void;
}

interface Visibility {
  pay: boolean;
  plan: boolean;
  draft: boolean;
  redo: boolean;
  writeOff: boolean;
  send: boolean;
}

/**
 * Skicka-knappen (#179/#392): en faktura kan skickas i DRAFT (då blir den SENT),
 * är utställd (SENT/avbetalningsplan → kan skickas om), eller är en icke-annullerad
 * kreditfaktura. Modalen erbjuder automatiskt (köa → server) + manuellt utskick.
 */
function canSend(isCredit: boolean, status: InvoiceStatus): boolean {
  return isSendable(status) || (isCredit && status !== "CANCELLED");
}

function computeVisibility(invoiceType: InvoiceType, status: InvoiceStatus, hasPlan: boolean, outstanding: number): Visibility {
  const isCredit = invoiceType === "CREDIT";
  const sentNoPlan = !isCredit && status === "SENT" && !hasPlan;
  // Utställd & aktiv (SENT eller pågående avbetalningsplan, ej kreditfaktura).
  const issuedActive = !isCredit && isLive(status);
  return {
    pay: !isCredit && !isTerminal(status),
    plan: sentNoPlan,
    draft: status === "DRAFT",
    // En ingång för alla icke-annullerade fakturor; dialogen förklarar vägen
    // per läge. En skickad faktura annulleras aldrig rakt av — den krediteras.
    redo: !isCredit && status !== "CANCELLED",
    // Avskrivning: utställd faktura med utestående kvar (även en plan-faktura
    // som klienten slutat betala) → räkna-en-gång (ADR 0007).
    writeOff: issuedActive && outstanding > 0,
    send: canSend(isCredit, status),
  };
}

export function InvoiceActions({
  invoiceType, status, hasPlan, outstanding,
  onShowPayment, onShowPlan, onShowRedo, onShowWriteOff, onShowSend, onSetStatus,
}: Props) {
  const v = computeVisibility(invoiceType, status, hasPlan, outstanding);

  return (
    <div className="mt-2 flex gap-2 flex-wrap">
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
      {v.writeOff && (
        <button onClick={onShowWriteOff} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50">
          Skriv av som kundförlust
        </button>
      )}
      {v.redo && (
        <button onClick={onShowRedo} className="px-3 py-1.5 text-sm border border-orange-200 text-orange-700 rounded hover:bg-orange-50">
          Fel på fakturan?
        </button>
      )}
    </div>
  );
}
