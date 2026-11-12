"use client";

/**
 * `PaymentMethodFields` — ärendets betalningsdel som styrd fältkomponent
 * (`value`/`onChange`, som `HourlyRatesFields`), utan egen sparknapp (#1564).
 * State och omvandling till `matter.update`-indata: `usePaymentMethodForm`.
 */

import { useId } from "react";
import { HourlyRatesFields } from "@/components/billing/hourly-rates-fields";
import { paymentMethodOptions } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { paymentMethodSchema, type PaymentMethod } from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import type { PaymentMethodFormValues } from "./use-payment-method-form";

const INPUT_CLASS = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm";

/** Betalningssätt där klienten betalar en %-sats → visa/redigera andelen. */
export function usesClientShare(method: PaymentMethod): boolean {
  return method === "RATTSSKYDD" || method === "RATTSHJALP";
}

/** Sätter ett enskilt fält i formulärets värden. */
type SetField = <K extends keyof PaymentMethodFormValues>(key: K, v: PaymentMethodFormValues[K]) => void;

interface Props {
  value: PaymentMethodFormValues;
  onChange: (next: PaymentMethodFormValues) => void;
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
        className={INPUT_CLASS}
      />
      <p className="mt-1 text-[11px] text-gray-400">
        {isAmount
          ? "Taket ur försäkringsbeslutet. Ärendet varnar vid 90 % av upparbetat värde."
          : "Rättshjälpslagen: 100 tim (höj vid beviljad utökad rättshjälp). Varnar vid 80 tim, eller 10 tim före ett utökat tak."}
      </p>
    </div>
  );
}

/** Visar rätt tak-fält för valt betalningssätt. */
function CoverageCapFields({ value, set }: { value: PaymentMethodFormValues; set: SetField }) {
  if (value.method === "RATTSSKYDD") {
    return <CoverageCapField method={value.method} value={value.rsMaxKr} onChange={(v) => set("rsMaxKr", v)} />;
  }
  if (value.method === "RATTSHJALP") {
    return <CoverageCapField method={value.method} value={value.rhMaxTim} onChange={(v) => set("rhMaxTim", v)} />;
  }
  return null;
}

/** Ett datumfält med etikett runt (rättsskyddets datum). */
function DateField({ label, value, onChange, className = "" }: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <label className={`block text-xs font-medium ${className}`}>{label}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${INPUT_CLASS}`} />
    </label>
  );
}

/** Rättsskyddets datum ur bolagets beslut (#810): tvistdatum (arbete före = ej
 *  täckt) + beslutsdatum (retroaktivt täcks ≤6 h). Endast för rättsskydd. */
function RattsskyddDates({ value, set }: { value: PaymentMethodFormValues; set: SetField }) {
  if (value.method !== "RATTSSKYDD") return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <DateField label="Tvist uppkom (datum)" value={value.tvist} onChange={(v) => set("tvist", v)} />
      <DateField label="Försäkringens beslut (datum)" value={value.beslut} onChange={(v) => set("beslut", v)} />
      <DateField label="Rättsskydd nekat (datum)" value={value.nekad} onChange={(v) => set("nekad", v)} className="col-span-2" />
    </div>
  );
}

/** %-andels-fältet (självrisk/avgift). */
function ClientShareField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1">
        Klientens andel att betala (%)
      </label>
      <input id={id} type="text" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)} placeholder="t.ex. 25" className={INPUT_CLASS} />
      <p className="mt-1 text-[11px] text-gray-400">
        Självrisk/avgift av upparbetat värde. Kan ändras under ärendets gång (t.ex. vid ändrad inkomst).
      </p>
    </div>
  );
}

/**
 * Ärendets avvikande timpriser — ovanligt, så de ligger hopfällda längst ned och
 * tar ingen plats i vardagen. Tomt fält = den registrerande juristens pris, annars
 * byråns (placeholdern visar byråns — juristens beror på vem som skriver tid).
 */
function MatterRateField({ value, onChange }: { value: HourlyRates; onChange: (v: HourlyRates) => void }) {
  const org = trpc.organization.getSettings.useQuery();
  return (
    <details open={Object.keys(value).length > 0} className="rounded border border-gray-200 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-gray-600">Avvikande timpris för ärendet</summary>
      <p className="mt-2 mb-2 text-[11px] text-gray-500">Tomt = juristens pris, annars byråns. Gäller tid som registreras efter ändringen.</p>
      <HourlyRatesFields value={value} onChange={onChange} parents={[org.data?.hourlyRates]} />
    </details>
  );
}

/** Betalningssättets rullgardinsmeny. */
function MethodSelect({ value, onChange }: { value: PaymentMethod; onChange: (v: PaymentMethod) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1">Betalningssätt</label>
      <select id={id} value={value} onChange={(e) => onChange(paymentMethodSchema.parse(e.target.value))} className={INPUT_CLASS}>
        {paymentMethodOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Beslutsdatum och notering — gäller alla betalningssätt. */
function DecisionFields({ value, set }: { value: PaymentMethodFormValues; set: SetField }) {
  const [decidedAtId, noteId] = [useId(), useId()];
  return (
    <>
      <div>
        <label htmlFor={decidedAtId} className="block text-xs font-medium mb-1">
          Beslutsdatum (om rättshjälp/rättsskydd beviljats)
        </label>
        <input id={decidedAtId} type="date" value={value.decidedAt}
          onChange={(e) => set("decidedAt", e.target.value)} className={INPUT_CLASS} />
      </div>
      <div>
        <label htmlFor={noteId} className="block text-xs font-medium mb-1">
          Notering (t.ex. försäkringsbolag, försäkringsnummer, beslutsnummer)
        </label>
        <textarea id={noteId} value={value.note} onChange={(e) => set("note", e.target.value)} rows={2}
          className={INPUT_CLASS}
          placeholder="T.ex. Trygg-Hansa, nr. TH-2024-4455 · Självrisk 20% · Maxbelopp 75 000 kr" />
      </div>
    </>
  );
}

/** Alla betalningsfält, styrda av `value`/`onChange`. */
export function PaymentMethodFields({ value, onChange }: Props) {
  const set: SetField = (key, v) => onChange({ ...value, [key]: v });
  return (
    <>
      <MethodSelect value={value.method} onChange={(v) => set("method", v)} />
      {usesClientShare(value.method) && (
        <ClientShareField value={value.sharePct} onChange={(v) => set("sharePct", v)} />
      )}
      <CoverageCapFields value={value} set={set} />
      <RattsskyddDates value={value} set={set} />
      <DecisionFields value={value} set={set} />
      <MatterRateField value={value.rates} onChange={(v) => set("rates", v)} />
    </>
  );
}
