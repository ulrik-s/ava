"use client";

/**
 * `HourlyRatesFields` — timpris per timbaserad kategori (#1206), samma fyra
 * kr/h-fält på byrå (Inställningar), jurist (användarformuläret) och ärende
 * (Betalningssätt → Ändra). Värdet är kartan i öre; fälten visar kronor.
 * Tomt fält = inget eget pris på den här nivån → placeholdern visar vad som
 * ärvs i stället.
 */

import { useId } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { inheritedHourlyRate, type LevelRates } from "@/lib/shared/hourly-rate";
import {
  HOURLY_TIME_ENTRY_KINDS, TIME_ENTRY_KIND_LABELS, type HourlyTimeEntryKind,
} from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";

/** Föreskriftens omfång, kort — den fullständiga texten visas vid kategorivalet. */
const KIND_SCOPE: Partial<Record<HourlyTimeEntryKind, string>> = {
  ARBETE_OBEKVAM_TID: "Häktningsförhandling helg, polisförhör kväll/natt/helg.",
  TIDSSPILLAN: "Vardag 08–18 (och vid helghäktning/nattförhör).",
  TIDSSPILLAN_OVRIG_TID: "Annan tid — ersätts bara 07–22.",
};

/** Öre/h → "1 626 kr/h". */
export function formatKrPerHour(ore: number): string {
  return `${new Intl.NumberFormat("sv-SE").format(ore / 100)} kr/h`;
}

/** Kartan med `kind` satt till `kr` (i öre), eller borttagen när fältet töms. */
export function withRate(rates: HourlyRates, kind: HourlyTimeEntryKind, kr: number | null): HourlyRates {
  const next: HourlyRates = { ...rates };
  if (kr == null) delete next[kind];
  else next[kind] = Math.round(kr * 100);
  return next;
}

interface Props {
  /** Nivåns egna priser (öre/h). */
  value: HourlyRates;
  onChange: (next: HourlyRates) => void;
  /** Nivåerna ovanför, mest specifik först — ger placeholderns ärvda värde. */
  parents?: readonly LevelRates[];
}

export function HourlyRatesFields({ value, onChange, parents = [] }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {HOURLY_TIME_ENTRY_KINDS.map((kind) => (
        <HourlyRateInput key={kind} kind={kind} value={value} onChange={onChange} parents={parents} />
      ))}
    </div>
  );
}

function HourlyRateInput({ kind, value, onChange, parents }: Required<Props> & { kind: HourlyTimeEntryKind }) {
  const id = useId();
  const own = value[kind];
  const inherited = inheritedHourlyRate(kind, value, parents);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
        {TIME_ENTRY_KIND_LABELS[kind]} (kr/h, exkl moms)
      </label>
      <DecimalInput id={id} value={own != null ? own / 100 : null}
        onChange={(kr) => onChange(withRate(value, kind, kr))}
        placeholder={inherited != null ? `ärvs: ${formatKrPerHour(inherited)}` : "ej satt"}
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      {KIND_SCOPE[kind] && <p className="text-[11px] text-gray-500 mt-1">{KIND_SCOPE[kind]}</p>}
    </div>
  );
}
