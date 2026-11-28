"use client";

/**
 * "Fel på fakturan?" (#2260) — EN ingång på fakturasidan för den som gjort fel.
 * Dialogen förklarar och erbjuder rätt väg för fakturans läge, enligt samma
 * regel som servern (`redoOption`):
 *   - ett obokfört utkast makuleras (numret kvar, posterna tillbaka),
 *   - en skickad eller bokförd faktura krediteras och görs om; därefter öppnas
 *     ärendets fakturering så att den rätta fakturan kan skapas direkt,
 *   - annars förklaras varför den inte kan göras om här.
 *
 * Mutationerna kommer som props (sidan äger dem); dialogen navigerar själv
 * till faktureringen efter en lyckad kreditering.
 */

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { shellPath } from "@/lib/client/demo/entity-href";
import { BILLING_SHORTCUT_PARAM } from "@/lib/shared/billing/billing-flow";
import { redoFactsOf, redoOption, type RedoInvoice, type RedoOption } from "@/lib/shared/billing/invoice-redo";
import { formatKr } from "@/lib/shared/kr-format";
import { ledgerRefOf, type LedgerRefRow } from "@/lib/shared/ledger-ref";
import type { InvoiceType } from "@/lib/shared/schemas/enums";

/** Texten för fakturans väg: rubrik, förklaring och bekräftelseknappen (saknas = ingen väg). */
export interface RedoCopy {
  lead: string;
  points: readonly string[];
  confirm?: string | undefined;
}

/** Det texten behöver om fakturan. */
interface CopyInput {
  invoiceNumber: string;
  amount: number;
  hasActivePlan: boolean;
}

/** Dialogens text för vägen — ren funktion, så att varje läge kan prövas för sig. */
export function redoCopy(option: RedoOption, inv: CopyInput): RedoCopy {
  const nr = inv.invoiceNumber;
  switch (option.kind) {
    case "void":
      return {
        lead: `Faktura ${nr} är skapad men inte skickad eller bokförd. Makulera den och skapa en ny.`,
        points: [
          `Fakturan finns kvar som annullerad med sitt nummer ${nr}, som inte används igen.`,
          "Tidsposterna och utläggen kommer tillbaka under Fakturera.",
          "Aconton som fakturan drog av kan dras av på nästa faktura.",
        ],
        confirm: `Makulera faktura ${nr}`,
      };
    case "credit":
      return {
        lead: `Faktura ${nr} är skickad eller bokförd och kan inte ändras eller makuleras. Kreditera den och gör om.`,
        points: [
          `En kreditfaktura på ${formatKr(-inv.amount)} får ett nytt nummer och hänvisar till faktura ${nr}, som annulleras.`,
          ...(inv.hasActivePlan ? ["Avbetalningsplanen avbryts."] : []),
          "Tidsposterna och utläggen kommer tillbaka under Fakturera.",
          "Faktureringen öppnas sedan, så att du kan skapa den rätta fakturan direkt.",
        ],
        confirm: `Kreditera faktura ${nr} och gör om`,
      };
    case "blocked":
      return { lead: option.reason, points: [] };
    default: {
      const never: never = option;
      return never;
    }
  }
}

/** Faktureringsdialogen som ska öppnas för den nya fakturan: aconto för ett aconto, annars faktura. */
export function redoBillingType(invoiceType: InvoiceType): "ACCONTO" | "FINAL" {
  return invoiceType === "ACCONTO" ? "ACCONTO" : "FINAL";
}

/** Fakturan så som dialogen läser den (en delmängd av `invoice.getById`). */
export interface RedoDialogInvoice extends RedoInvoice, LedgerRefRow {
  matterId: string;
  invoiceNumber?: string | null | undefined;
  amount: number;
}

interface Props {
  inv: RedoDialogInvoice;
  paidOre: number;
  writtenOffOre: number;
  hasActivePlan: boolean;
  isPending: boolean;
  error: string | null;
  /** Makulera utkastet. */
  onVoid: () => Promise<unknown>;
  /** Kreditera och gör om, med valfri anledning på kreditfakturan. */
  onCredit: (notes: string | undefined) => Promise<unknown>;
  onClose: () => void;
}

/** Kör åtgärden; ett fel visas av sidan (`error`), så det sväljs här. */
async function attempt(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

export function RedoInvoiceDialog({ inv, paidOre, writtenOffOre, hasActivePlan, isPending, error, onVoid, onCredit, onClose }: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const notesId = useId();
  const option = redoOption(redoFactsOf(inv, { ledgerRef: ledgerRefOf(inv), paidOre, writtenOffOre }));
  const copy = redoCopy(option, { invoiceNumber: inv.invoiceNumber ?? "(utan nummer)", amount: inv.amount, hasActivePlan });

  const confirm = async (): Promise<void> => {
    if (option.kind === "void") {
      await onVoid();
      return;
    }
    if (!(await attempt(() => onCredit(notes.trim() || undefined)))) return;
    router.push(shellPath("matters", inv.matterId, undefined, { [BILLING_SHORTCUT_PARAM]: redoBillingType(inv.invoiceType) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div role="dialog" aria-labelledby={`${notesId}-title`} className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 id={`${notesId}-title`} className="font-semibold mb-2">Fel på fakturan?</h3>
        <p className="text-sm text-gray-700 mb-2">{copy.lead}</p>
        {copy.points.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1 mb-3">
            {copy.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {option.kind === "credit" && (
          <div className="mb-3">
            <label htmlFor={notesId} className="block text-xs font-medium mb-1">Anledning (valfri, står på kreditfakturan)</label>
            <textarea id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="T.ex. fel timpris" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">{copy.confirm ? "Avbryt" : "Stäng"}</button>
          {copy.confirm && (
            <button disabled={isPending} onClick={() => void attempt(confirm)}
              className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50">
              {isPending ? "Arbetar…" : copy.confirm}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
