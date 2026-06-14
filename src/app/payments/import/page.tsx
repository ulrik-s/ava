"use client";

/**
 * Betalfils-import (#181): ladda upp en camt.054/053-fil (SEB/Bankgirot,
 * "Kontohändelser via fil") → parsa → matcha mot fakturor (OCR #182,
 * fakturanummer, fri text) → förhandsgranska → bokför via recordPayment.
 *
 * Logiken bor i `@/lib/shared/payments/` (camt-parse + match-payments, pure
 * och enhetstestade) — sidan är bara filläsning + förhandsgranskning + knapp.
 * Omatchade transaktioner visas med orsak (granskningskön v1, jfr #175).
 */

import { useMemo, useState } from "react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { parseCamtXml, type CamtFile } from "@/lib/shared/payments/camt-parse";
import {
  matchTransactions,
  type InvoiceCandidate,
  type MatchOutcome,
  type BookablePayment,
} from "@/lib/shared/payments/match-payments";
import {
  matchReceivables,
  type ReceivableCandidate,
  type ReceivableSuggestion,
} from "@/lib/shared/payments/match-receivables";

interface InvoiceRowData {
  id: string;
  invoiceNumber?: string | null;
  ocrReference?: string | null;
  amount: number;
  payments?: Array<{ reference?: string | null }>;
}

function toCandidates(rows: readonly InvoiceRowData[]): InvoiceCandidate[] {
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? null,
    ocrReference: r.ocrReference ?? null,
    amount: r.amount,
    paymentReferences: (r.payments ?? []).map((p) => p.reference).filter((x): x is string => !!x),
  }));
}

const MATCHED_BY_LABEL: Record<BookablePayment["matchedBy"], string> = {
  ocr: "OCR",
  invoiceNumber: "Fakturanr",
  freetext: "Fri text",
};

const REASON_LABEL: Record<string, string> = {
  "ingen-träff": "Ingen träff — koppla manuellt",
  tvetydig: "Tvetydig (flera fakturor träffas)",
  dubblett: "Redan importerad",
  debet: "Debet-post (ej inbetalning)",
};

export default function PaymentImportPage() {
  const [xml, setXml] = useState("");
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const invoices = trpc.invoice.list.useQuery({});
  const receivables = trpc.expectedReceivable.candidates.useQuery();
  const utils = trpc.useUtils();
  const recordPayment = trpc.invoice.recordPayment.useMutation();
  const settleReceivable = trpc.expectedReceivable.settle.useMutation();

  const parsed = useMemo((): { file?: CamtFile; error?: string } => {
    if (!xml.trim()) return {};
    try {
      return { file: parseCamtXml(xml) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [xml]);

  const outcome = useMemo((): MatchOutcome | null => {
    if (!parsed.file || !invoices.data) return null;
    return matchTransactions(parsed.file.transactions, toCandidates(invoices.data as InvoiceRowData[]));
  }, [parsed.file, invoices.data]);

  const labels = useMemo((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of (invoices.data ?? []) as InvoiceRowData[]) out[r.id] = r.invoiceNumber ?? r.id;
    return out;
  }, [invoices.data]);

  // #175: matcha domstolsbetalningar (fri text) mot förväntade fordringar.
  const receivableSuggestions = useMemo((): ReceivableSuggestion[] => {
    if (!parsed.file || !receivables.data) return [];
    const cands: ReceivableCandidate[] = (receivables.data as Array<Omit<ReceivableCandidate, "settledReferences">>).map((c) => ({ ...c, settledReferences: [] }));
    return matchReceivables(parsed.file.transactions, cands).suggestions;
  }, [parsed.file, receivables.data]);

  const receivableLabels = useMemo((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const c of (receivables.data ?? []) as Array<{ id: string; description: string }>) out[c.id] = c.description;
    return out;
  }, [receivables.data]);

  const settleSuggestion = async (s: ReceivableSuggestion): Promise<void> => {
    await settleReceivable.mutateAsync({ id: s.receivableId, settledAmount: s.amountOre, paymentReference: s.reference });
    await utils.expectedReceivable.candidates.invalidate();
    await utils.expectedReceivable.list.invalidate();
    setDoneMsg("Domstolsbetalning avprickad mot fordran.");
  };

  const book = async (bookable: BookablePayment[]): Promise<void> => {
    let ok = 0;
    for (const b of bookable) {
      await recordPayment.mutateAsync({
        invoiceId: b.invoiceId,
        amount: b.amountOre,
        paidAt: b.tx.valueDate ?? new Date().toISOString().slice(0, 10),
        note: b.tx.debtorName ? `Betalfils-import — ${b.tx.debtorName}` : "Betalfils-import",
        reference: b.reference,
      });
      ok += 1;
    }
    await utils.invoice.list.invalidate();
    setDoneMsg(`${ok} betalning${ok === 1 ? "" : "ar"} bokförda.`);
    setXml("");
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Importera betalfil</h1>
      <p className="text-sm text-gray-500 mb-6">
        camt.054/053 (SEB/Bankgirot &quot;Kontohändelser via fil&quot;) — matchas mot OCR, fakturanummer eller fri text.
        Domstolsbetalningar (utan OCR) matchas på ärende-/målnummer mot förväntade fordringar (#173).
        Driftskrav: ta emot domstolsbetalningar på ett bankgiro/konto som tillåter <em>fri referens</em> —
        ett OCR-låst bankgiro kan avvisa betalningar utan OCR.
      </p>
      {doneMsg && <p className="mb-4 text-sm text-green-700 bg-green-50 rounded p-3">{doneMsg}</p>}
      <FilePicker onXml={(s) => { setDoneMsg(null); setXml(s); }} xml={xml} />
      {parsed.error && <p className="mt-4 text-sm text-red-700">Kunde inte läsa filen: {parsed.error}</p>}
      {outcome && (
        <ImportPreview outcome={outcome} labels={labels} busy={recordPayment.isPending} onBook={() => void book(outcome.bookable)} />
      )}
      {receivableSuggestions.length > 0 && (
        <ReceivableSuggestions
          suggestions={receivableSuggestions}
          labels={receivableLabels}
          busy={settleReceivable.isPending}
          onSettle={(s) => void settleSuggestion(s)}
        />
      )}
    </div>
  );
}

/** #175: föreslagna avprickningar mot förväntade domstols-fordringar (manuell bekräftelse). */
function ReceivableSuggestions({
  suggestions,
  labels,
  busy,
  onSettle,
}: {
  suggestions: ReceivableSuggestion[];
  labels: Record<string, string>;
  busy: boolean;
  onSettle: (s: ReceivableSuggestion) => void;
}) {
  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 mb-1">Domstolsbetalningar — förväntade fordringar ({suggestions.length})</h2>
      <p className="text-xs text-gray-500 mb-3">
        Matchade på ärende-/målnummer i betalningens referens. Bekräfta varje avprickning —
        utbetalt belopp bokas (ev. prutning hanteras automatiskt, #173).
      </p>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {suggestions.map((s) => (
            <tr key={s.reference}>
              <td className="py-2">{labels[s.receivableId] ?? s.receivableId}</td>
              <td className="py-2 text-xs text-gray-500 font-mono">{s.matchedText}</td>
              <td className="py-2 text-right font-mono">{formatCurrency(s.amountOre)}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => onSettle(s)}
                  disabled={busy}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Pricka av
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilePicker({ onXml, xml }: { onXml: (s: string) => void; xml: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Välj camt-fil (XML)
        <input
          type="file"
          accept=".xml,text/xml"
          className="block mt-2 text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then(onXml);
          }}
        />
      </label>
      <details>
        <summary className="text-xs text-gray-500 cursor-pointer">…eller klistra in filinnehållet</summary>
        <textarea
          aria-label="camt-XML"
          className="mt-2 w-full h-32 border border-gray-200 rounded p-2 font-mono text-xs"
          value={xml}
          onChange={(e) => onXml(e.target.value)}
        />
      </details>
    </div>
  );
}

function ImportPreview({ outcome, labels, busy, onBook }: { outcome: MatchOutcome; labels: Record<string, string>; busy: boolean; onBook: () => void }) {
  const sum = outcome.bookable.reduce((s, b) => s + b.amountOre, 0);
  return (
    <div className="mt-6 space-y-6">
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Matchade betalningar ({outcome.bookable.length})</h2>
        {outcome.bookable.length === 0 ? (
          <p className="text-sm text-gray-500">Inga matchade betalningar i filen.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-1.5 font-normal">Faktura</th>
                <th className="py-1.5 font-normal">Matchad via</th>
                <th className="py-1.5 font-normal">Betalare</th>
                <th className="py-1.5 font-normal">Datum</th>
                <th className="py-1.5 font-normal text-right">Belopp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outcome.bookable.map((b) => <BookableRow key={b.reference} b={b} label={labels[b.invoiceId] ?? b.invoiceId} />)}
            </tbody>
          </table>
        )}
        {outcome.bookable.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-600">Summa: <span className="font-mono font-medium">{formatCurrency(sum)}</span></span>
            <button
              type="button"
              disabled={busy}
              onClick={onBook}
              className="bg-blue-600 text-white text-sm font-medium rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Bokför…" : `Bokför ${outcome.bookable.length} betalningar`}
            </button>
          </div>
        )}
      </section>
      {outcome.unmatched.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-3">Kräver granskning ({outcome.unmatched.length})</h2>
          <ul className="space-y-1.5 text-sm">
            {outcome.unmatched.map((u) => (
              <li key={u.tx.reference} className="flex items-center justify-between">
                <span className="text-gray-700">
                  {u.tx.debtorName ?? "Okänd betalare"}
                  <span className="ml-2 text-xs text-gray-400">{u.tx.freeTexts.join(" · ") || u.tx.structuredRefs.map((r) => r.ref).join(" · ")}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono">{formatCurrency(u.tx.amountOre)}</span>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">{REASON_LABEL[u.reason] ?? u.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BookableRow({ b, label }: { b: BookablePayment; label: string }) {
  return (
    <tr>
      <td className="py-1.5">
        <EntityLink route="invoices" id={b.invoiceId} className="text-blue-600 hover:underline font-mono text-xs">
          {label}
        </EntityLink>
      </td>
      <td className="py-1.5">
        <span className="text-[10px] rounded-full px-2 py-0.5 font-medium bg-green-100 text-green-700">{MATCHED_BY_LABEL[b.matchedBy]}</span>
      </td>
      <td className="py-1.5 text-gray-600">{b.tx.debtorName ?? "—"}</td>
      <td className="py-1.5 font-mono text-xs text-gray-500">{b.tx.valueDate ?? "—"}</td>
      <td className="py-1.5 text-right font-mono">{formatCurrency(b.amountOre)}</td>
    </tr>
  );
}
