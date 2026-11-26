"use client";

/**
 * Ersättningstypen i kostnadsräkningsdialogen (#1858): brottmålstaxan (med
 * huvudförhandlingens klocka), förordnandetaxan (förhören och hur
 * förundersökningen avslutades) eller timkostnadsnormen. Utbrutet ur
 * `_kostnadsrakning-modal.tsx`, som importerar valet, förhörsavsnittet och
 * anropets yrkande (`KrRunClaim`) härifrån.
 */

import { useState } from "react";
import type { TaxaLevel } from "@/lib/shared/brottmalstaxa";
import { forhorFromTimeEntries, forhorMinutes, type Forhor, type ForhorTimeEntry } from "@/lib/shared/forordnandetaxa";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { forordnandeAvslutSchema, type ForordnandeAvslut } from "@/lib/shared/schemas/enums";
import { isLockedEntry, type LockableEntry } from "@/lib/shared/time-entry-lock";

/** Vad räkningen står på: brottmålstaxa, förordnandetaxa eller löpande räkning. */
export type KrErsattning = "taxa" | "forordnande" | "lopande";

/**
 * Det dialogen yrkar på — servern räknar körningens belopp ur samma underlag.
 * Förhandlingsfälten för brottmålstaxan och den löpande räkningen, eller
 * förundersökningens avslut i ett förordnandemål (förhören läser servern ur
 * ärendets poster, #1857).
 */
export type KrRunClaim =
  | { hufStart: string; hufEnd: string; taxaLevel: TaxaLevel; isTaxeArende: boolean; hasFTax: boolean }
  | { forordnande: { avslut: ForordnandeAvslut }; hasFTax: boolean };

const ERSATTNING_LABELS: Record<KrErsattning, string> = {
  taxa: "Taxa (brottmålstaxan DVFS 2025:6)",
  forordnande: "Förordnandetaxa (DVFS 2025:5)",
  lopande: "Icke-taxa (timkostnadsnorm × all tid)",
};

/** Dialogens texter för avslutet; nycklarna är de delade (`enums.ts`, #1855). */
const AVSLUT_LABELS: Record<ForordnandeAvslut, string> = {
  NEDLAGD: "Lades ned",
  STRAFFORELAGGANDE: "Strafföreläggande godkändes",
  INGET_ATAL: "Avslutades utan åtal",
};

/**
 * Valen i dialogen: brottmålstaxan bara med en förhandlingspost, och
 * förordnandetaxan bara i ett offentligt uppdrag.
 */
export function ersattningOptions(hearing: boolean, isOffentligtUppdrag: boolean): KrErsattning[] {
  return [
    ...(hearing ? ["taxa" as const] : []),
    ...(isOffentligtUppdrag ? ["forordnande" as const] : []),
    "lopande",
  ];
}

/**
 * Det valda: förordnandetaxan när den valts i ett offentligt uppdrag, annars
 * brottmålstaxan med förhandling och taxeval, annars löpande räkning.
 */
export function ersattningOf(a: { forordnande: boolean; isOffentligtUppdrag: boolean; hearing: boolean; isTaxe: boolean }): KrErsattning {
  if (a.forordnande && a.isOffentligtUppdrag) return "forordnande";
  return a.hearing && a.isTaxe ? "taxa" : "lopande";
}

/** Valet av ersättningstyp och avslut i dialogen (det `useErsattning` ger). */
export interface ErsattningChoice {
  ersattning: KrErsattning;
  /** Valen som visas, i ordning. */
  options: KrErsattning[];
  onErsattning: (v: KrErsattning) => void;
  avslut: ForordnandeAvslut | null;
  setAvslut: (v: ForordnandeAvslut) => void;
}

/**
 * Dialogens val (#1858). Brottmålstaxan är förvald med förhandlingspost som i
 * dag (ärendets taxeval), annars löpande räkning; förordnandetaxan väljs aktivt.
 */
export function useErsattning(a: { initialIsTaxe: boolean | undefined; isOffentligtUppdrag: boolean; hearing: boolean }): ErsattningChoice {
  const [isTaxe, setIsTaxe] = useState<boolean>(a.initialIsTaxe ?? true);
  const [forordnande, setForordnande] = useState(false);
  const [avslut, setAvslut] = useState<ForordnandeAvslut | null>(null);
  return {
    ersattning: ersattningOf({ forordnande, isOffentligtUppdrag: a.isOffentligtUppdrag, hearing: a.hearing, isTaxe }),
    options: ersattningOptions(a.hearing, a.isOffentligtUppdrag),
    onErsattning: (v) => {
      setForordnande(v === "forordnande");
      if (v !== "forordnande") setIsTaxe(v === "taxa");
    },
    avslut, setAvslut,
  };
}

/** Förhören ur de poster som inte är låsta — samma ofrusna poster som servern läser. */
export function forhorOf(entries: ReadonlyArray<ForhorTimeEntry & LockableEntry>): Forhor[] {
  return forhorFromTimeEntries(entries.filter((e) => !isLockedEntry(e)));
}

/** Domänens förordnande-indata i förordnandeläget, annars inget. */
export function forordnandeInputOf(
  ersattning: KrErsattning, entries: ReadonlyArray<ForhorTimeEntry & LockableEntry>, avslut: ForordnandeAvslut | null,
): { forordnande?: { forhor: Forhor[]; avslut?: ForordnandeAvslut } } {
  if (ersattning !== "forordnande") return {};
  return { forordnande: { forhor: forhorOf(entries), ...(avslut ? { avslut } : {}) } };
}

/**
 * Anropets yrkande, eller null när förordnandetaxan saknar avslut (då går
 * dokumentet inte att generera).
 */
export function krRunClaimOf(a: {
  ersattning: KrErsattning; avslut: ForordnandeAvslut | null;
  hufStart: string; hufEnd: string; taxaLevel: TaxaLevel; hasFTax: boolean;
}): KrRunClaim | null {
  if (a.ersattning === "forordnande") return a.avslut ? { forordnande: { avslut: a.avslut }, hasFTax: a.hasFTax } : null;
  return {
    hufStart: new Date(a.hufStart).toISOString(), hufEnd: new Date(a.hufEnd).toISOString(),
    taxaLevel: a.taxaLevel, isTaxeArende: a.ersattning === "taxa", hasFTax: a.hasFTax,
  };
}

/** Ersättningstyp (taxa, förordnandetaxa eller icke-taxa) + ev. taxa-nivå. */
export function ErsattningSection({ options, ersattning, onChange, level, setLevel }: {
  options: readonly KrErsattning[]; ersattning: KrErsattning; onChange: (v: KrErsattning) => void;
  level: TaxaLevel; setLevel: (v: TaxaLevel) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <span className="text-xs text-gray-700 mb-1 block">Ersättningstyp</span>
        <div className="flex flex-col sm:flex-row gap-3">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-base">
              <input type="radio" name="kr-ersattning" checked={ersattning === o} onChange={() => onChange(o)} className="w-5 h-5" />
              {ERSATTNING_LABELS[o]}
            </label>
          ))}
        </div>
      </div>
      {ersattning === "taxa" && (
        <label className="block">
          <span className="text-xs text-gray-700 mb-1 block">Ersättningsnivå (DVFS 2025:6)</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value) as TaxaLevel)}
            className="w-full rounded border border-gray-300 px-3 py-2.5 text-base">
            <option value={1}>1 — Grundersättning</option>
            <option value={2}>2 — + häktningsförh. m.m.</option>
            <option value={3}>3 — + RPU</option>
            <option value={4}>4 — + häktning m.m. + RPU</option>
          </select>
        </label>
      )}
    </section>
  );
}

/** Hur förundersökningen avslutades — måste väljas innan dokumentet genereras. */
export function AvslutChoice({ avslut, onChange }: { avslut: ForordnandeAvslut | null; onChange: (v: ForordnandeAvslut) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs text-gray-700 mb-1">Förundersökningen</legend>
      <div className="flex flex-col sm:flex-row gap-3">
        {forordnandeAvslutSchema.options.map((a) => (
          <label key={a} className="flex items-center gap-2 text-base">
            <input type="radio" name="kr-avslut" checked={avslut === a} onChange={() => onChange(a)} className="w-5 h-5" />
            {AVSLUT_LABELS[a]}
          </label>
        ))}
      </div>
      {avslut === null && <p className="text-xs text-amber-800">Välj hur förundersökningen avslutades.</p>}
    </fieldset>
  );
}

/** Förhören som grund (antal och sammanlagd tid) och dokumentets noter. */
export function ForhorSection({ forhor, notes }: { forhor: readonly Forhor[]; notes: readonly string[] }) {
  const minutes = forhor.reduce((s, f) => s + forhorMinutes(f), 0);
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700" aria-label="Förhör">
      <h3 className="font-semibold">Förhör</h3>
      <p className="mt-1">
        {forhor.length === 0
          ? "Inga förhör registrerade — taxans lägsta belopp (6 §)."
          : `${forhor.length} förhör, sammanlagt ${formatDecimalHoursWithUnit(minutes)}`}
      </p>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-gray-600">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}
