"use client";

/**
 * Betalningssätt-widget på matter-sidan.
 *
 * Visar nuvarande betalningssätt med färgkodad kreditriskindikering och
 * låter användaren ändra inline. Viktigt i familjerätt/försäkring där vi
 * behöver bedöma risken att få in pengarna.
 */

import { useId, useState } from "react";
import {
  PAYMENT_METHOD_LABELS,
  paymentMethodOptions,
  creditRiskFor,
  CREDIT_RISK_LABELS,
  type CreditRisk,
} from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { paymentMethodSchema, type PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

const RISK_BADGE: Record<CreditRisk, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  HIGH: "bg-red-50 text-red-700 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

interface Props {
  matterId: MatterId;
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | string | null;
  /** Klientens andel i bips (2500 = 25 %); null = ej satt (#778). */
  clientShareBips: number | null;
  /** Rättsskyddets maxbelopp i öre; null = ej satt (#793). */
  rattsskyddMaxOre: number | null;
  /** Rättshjälpens timtak; null → 100 tim (#793). */
  rattshjalpMaxTimmar: number | null;
  /** Rättsskydd: tvistdatum (arbete före = ej täckt) + bolagets beslutsdatum (#810). */
  tvistUppkomDatum?: Date | string | null | undefined;
  rattsskyddBeslutDatum?: Date | string | null | undefined;
  /** Rättsskydd: datum då rättsskydd nekades (#811). */
  rattsskyddNekadAt?: Date | string | null | undefined;
}

/** ISO-datum (yyyy-mm-dd) ur ett valfritt datumfält, tomt om saknas. */
function isoDate(d: Date | string | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

/** Betalningssätt där klienten betalar en %-sats → visa/redigera andelen. */
function usesClientShare(method: PaymentMethod): boolean {
  return method === "RATTSSKYDD" || method === "RATTSHJALP";
}

/** Läsvy: nuvarande betalningssätt + kreditrisk-badge + ev. notering/datum. */
/** Tak-text för läsvyn: belopp (rättsskydd) eller timmar (rättshjälp). */
function capLabel(method: PaymentMethod, rattsskyddMaxOre: number | null, rattshjalpMaxTimmar: number | null): string | null {
  if (method === "RATTSSKYDD") return rattsskyddMaxOre != null ? `Tak: ${rattsskyddMaxOre / 100} kr` : "Tak: ej satt";
  if (method === "RATTSHJALP") return `Tak: ${rattshjalpMaxTimmar ?? 100} tim`;
  return null;
}

function PaymentMethodView({
  paymentMethod,
  paymentMethodNote,
  paymentMethodDecidedAt,
  clientShareBips,
  rattsskyddMaxOre,
  rattshjalpMaxTimmar,
  onEdit,
}: {
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | string | null;
  clientShareBips: number | null;
  rattsskyddMaxOre: number | null;
  rattshjalpMaxTimmar: number | null;
  onEdit: () => void;
}) {
  const risk = creditRiskFor(paymentMethod);
  const badgeClass = RISK_BADGE[risk];
  const label = PAYMENT_METHOD_LABELS[paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? paymentMethod;
  const showShare = usesClientShare(paymentMethod);
  const cap = showShare ? capLabel(paymentMethod, rattsskyddMaxOre, rattshjalpMaxTimmar) : null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Betalningssätt
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{label}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 border ${badgeClass}`}>
              Kreditrisk: {CREDIT_RISK_LABELS[risk]}
            </span>
            {showShare && (
              <span className="text-xs rounded-full px-2 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">
                Klientens andel: {clientShareBips != null ? `${clientShareBips / 100} %` : "ej satt"}
              </span>
            )}
            {cap && (
              <span className="text-xs rounded-full px-2 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">
                {cap}
              </span>
            )}
          </div>
          {paymentMethodNote && <p className="text-sm text-gray-600 mt-1">{paymentMethodNote}</p>}
          {paymentMethodDecidedAt && (
            <p className="text-xs text-gray-400 mt-0.5">
              Beslut mottaget {new Date(paymentMethodDecidedAt).toLocaleDateString("sv-SE")}
            </p>
          )}
        </div>
        <button onClick={onEdit} className="text-sm text-blue-600 hover:underline whitespace-nowrap">
          Ändra
        </button>
      </div>
    </div>
  );
}

/** Tak-fältet: rättsskyddets maxbelopp (kr) eller rättshjälpens timtak. */
function CoverageCapField({ method, value, onChange }: { method: PaymentMethod; value: string; onChange: (v: string) => void }) {
  const isAmount = method === "RATTSSKYDD";
  return (
    <div>
      <label className="block text-xs font-medium mb-1">
        {isAmount ? "Försäkringens maxbelopp (kr)" : "Rättshjälpens tak (timmar)"}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isAmount ? "t.ex. 75000" : "100"}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
      />
      <p className="mt-1 text-[11px] text-gray-400">
        {isAmount
          ? "Taket ur försäkringsbeslutet. Ärendet varnar vid 90 % av upparbetat värde."
          : "Rättshjälpslagen: 100 tim (höj vid beviljad utökad rättshjälp). Varnar vid 90 %."}
      </p>
    </div>
  );
}

/** Visar rätt tak-fält för valt betalningssätt (utbrutet → editor-komplexitet ≤8). */
function CoverageCapFields({ method, rsMaxKr, setRsMaxKr, rhMaxTim, setRhMaxTim }: {
  method: PaymentMethod;
  rsMaxKr: string; setRsMaxKr: (v: string) => void;
  rhMaxTim: string; setRhMaxTim: (v: string) => void;
}) {
  if (method === "RATTSSKYDD") return <CoverageCapField method={method} value={rsMaxKr} onChange={setRsMaxKr} />;
  if (method === "RATTSHJALP") return <CoverageCapField method={method} value={rhMaxTim} onChange={setRhMaxTim} />;
  return null;
}

/** Rättsskyddets datum ur bolagets beslut (#810): tvistdatum (arbete före = ej
 *  täckt) + beslutsdatum (retroaktivt täcks ≤6 h). Endast för rättsskydd. */
function RattsskyddDates({ method, tvist, setTvist, beslut, setBeslut, nekad, setNekad }: {
  method: PaymentMethod;
  tvist: string; setTvist: (v: string) => void;
  beslut: string; setBeslut: (v: string) => void;
  nekad: string; setNekad: (v: string) => void;
}) {
  if (method !== "RATTSSKYDD") return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-xs font-medium">Tvist uppkom (datum)
        <input type="date" value={tvist} onChange={(e) => setTvist(e.target.value)}
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
      </label>
      <label className="block text-xs font-medium">Försäkringens beslut (datum)
        <input type="date" value={beslut} onChange={(e) => setBeslut(e.target.value)}
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
      </label>
      <label className="block text-xs font-medium col-span-2">Rättsskydd nekat (datum)
        <input type="date" value={nekad} onChange={(e) => setNekad(e.target.value)}
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
      </label>
    </div>
  );
}

/** %-andels-fältet (självrisk/avgift). Utbrutet så editorn håller sig ≤100 rader. */
function ClientShareField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1">
        Klientens andel att betala (%)
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="t.ex. 25"
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
      />
      <p className="mt-1 text-[11px] text-gray-400">
        Självrisk/avgift av upparbetat värde. Kan ändras under ärendets gång (t.ex. vid ändrad inkomst).
      </p>
    </div>
  );
}

/** Redigeringsformulär: äger sitt formulär-state + spar-mutationen. */
function PaymentMethodEditor({ matterId, initial, onDone }: { matterId: MatterId; initial: Props; onDone: () => void }) {
  const [method, setMethod] = useState(initial.paymentMethod);
  const [note, setNote] = useState(initial.paymentMethodNote ?? "");
  const [decidedAt, setDecidedAt] = useState(
    initial.paymentMethodDecidedAt ? new Date(initial.paymentMethodDecidedAt).toISOString().slice(0, 10) : "",
  );
  // %-sats redigeras i procent (bips/100); tomt fält → null. Tillåt komma-decimal.
  const [sharePct, setSharePct] = useState(initial.clientShareBips != null ? String(initial.clientShareBips / 100) : "");
  // Tak: rättsskydd i kr (öre/100), rättshjälp i timmar. Tomt fält → null.
  const [rsMaxKr, setRsMaxKr] = useState(initial.rattsskyddMaxOre != null ? String(initial.rattsskyddMaxOre / 100) : "");
  const [rhMaxTim, setRhMaxTim] = useState(initial.rattshjalpMaxTimmar != null ? String(initial.rattshjalpMaxTimmar) : "");
  const [tvist, setTvist] = useState(isoDate(initial.tvistUppkomDatum));
  const [beslut, setBeslut] = useState(isoDate(initial.rattsskyddBeslutDatum));
  const [nekad, setNekad] = useState(isoDate(initial.rattsskyddNekadAt));
  const methodId = useId();
  const decidedAtId = useId();
  const noteId = useId();
  const shareId = useId();

  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => {
      void utils.matter.getById.invalidate({ id: matterId });
      onDone();
    },
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Ändra betalningssätt</p>
      <div className="space-y-3">
        <div>
          <label htmlFor={methodId} className="block text-xs font-medium mb-1">Betalningssätt</label>
          <select
            id={methodId}
            value={method}
            onChange={(e) => setMethod(paymentMethodSchema.parse(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            {paymentMethodOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {usesClientShare(method) && (
          <ClientShareField id={shareId} value={sharePct} onChange={setSharePct} />
        )}
        <CoverageCapFields method={method} rsMaxKr={rsMaxKr} setRsMaxKr={setRsMaxKr} rhMaxTim={rhMaxTim} setRhMaxTim={setRhMaxTim} />
        <RattsskyddDates method={method} tvist={tvist} setTvist={setTvist} beslut={beslut} setBeslut={setBeslut} nekad={nekad} setNekad={setNekad} />
        <div>
          <label htmlFor={decidedAtId} className="block text-xs font-medium mb-1">
            Beslutsdatum (om rättshjälp/rättsskydd beviljats)
          </label>
          <input
            id={decidedAtId}
            type="date"
            value={decidedAt}
            onChange={(e) => setDecidedAt(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor={noteId} className="block text-xs font-medium mb-1">
            Notering (t.ex. försäkringsbolag, försäkringsnummer, beslutsnummer)
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder="T.ex. Trygg-Hansa, nr. TH-2024-4455 · Självrisk 20% · Maxbelopp 75 000 kr"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onDone} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
            Avbryt
          </button>
          <button
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                id: matterId,
                paymentMethod: method as Parameters<typeof update.mutate>[0]["paymentMethod"],
                paymentMethodNote: note || null,
                paymentMethodDecidedAt: decidedAt || null,
                clientShareBips: clientShareFromPct(sharePct),
                rattsskyddMaxOre: oreFromKr(rsMaxKr),
                rattshjalpMaxTimmar: positiveIntOrNull(rhMaxTim),
                tvistUppkomDatum: tvist || null,
                rattsskyddBeslutDatum: beslut || null,
                rattsskyddNekadAt: nekad || null,
              })
            }
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {update.isPending ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentMethodCard(props: Props) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <PaymentMethodEditor matterId={props.matterId} initial={props} onDone={() => setEditing(false)} />;
  }
  return (
    <PaymentMethodView
      paymentMethod={props.paymentMethod}
      paymentMethodNote={props.paymentMethodNote}
      paymentMethodDecidedAt={props.paymentMethodDecidedAt}
      clientShareBips={props.clientShareBips}
      rattsskyddMaxOre={props.rattsskyddMaxOre}
      rattshjalpMaxTimmar={props.rattshjalpMaxTimmar}
      onEdit={() => setEditing(true)}
    />
  );
}

/** Procent-textfält → bips (null om tomt/ogiltigt). Tillåter komma-decimal. */
function clientShareFromPct(pct: string): number | null {
  const trimmed = pct.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** Kr-textfält → öre (null om tomt/ogiltigt/negativt). Tillåter komma-decimal. */
function oreFromKr(kr: string): number | null {
  const trimmed = kr.trim().replace(/\s/g, "").replace(",", ".");
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Heltals-textfält → positivt heltal (null om tomt/ogiltigt/≤0). */
function positiveIntOrNull(s: string): number | null {
  const trimmed = s.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
