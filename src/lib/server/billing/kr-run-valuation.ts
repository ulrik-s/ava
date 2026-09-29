/**
 * Vad en kostnadsräknings KÖRNING yrkar i ett taxeärende (#1024, #1182).
 *
 * Brottmålstaxan styr arvodet (DVFS 2025:6), och dokumentet yrkar taxan +
 * tidsspillan utöver den timme som ingår + beredskapsdygnen. Körningen lagrade
 * förut posternas egna á-priser — ett belopp domstolen aldrig såg, som beslut
 * och prutning sedan räknades mot. Här räknas yrkandet med SAMMA funktion som
 * dokumentet (`kostnadsrakningClaimInclVat`).
 *
 * Taxan kräver huvudförhandlingens tid: från dialogen, annars den som sparats på
 * ärendet. Saknas den — eller överstiger den taxans maxgräns (1 §, 8 §) — vägras
 * inskicket hellre än att ett fel belopp yrkas.
 */

import { TRPCError } from "@trpc/server";
import { TAXA_MAX_MINUTES, type TaxaLevel } from "@/lib/shared/brottmalstaxa";
import { type ExpenseInput, kostnadsrakningClaimInclVat, type TimeEntryInput } from "@/lib/shared/kostnadsrakning";

/** Det dialogen skickar med inskicket (allt valfritt: skript/demo saknar dialog). */
export interface KrRunTaxaInput {
  hufStart?: string | undefined;
  hufEnd?: string | undefined;
  taxaLevel?: TaxaLevel | undefined;
  /** Dialogens val; saknas → ärendets. */
  isTaxeArende?: boolean | undefined;
  /** Dialogens F-skatt; saknas → ärendets (default: F-skatt). */
  hasFTax?: boolean | undefined;
}

/** Ärendefälten värderingen läser. */
export interface KrRunMatter {
  paymentMethod?: string | null | undefined;
  isTaxeArende?: boolean | null | undefined;
  taxaLevel?: number | null | undefined;
  taxaHasFTax?: boolean | null | undefined;
  taxaHuvudforhandlingMin?: number | null | undefined;
  taxaHufStart?: Date | string | null | undefined;
}

/** Arbetet som yrkas (de ofrysta posterna). */
export interface KrRunWork {
  timeEntries: readonly TimeEntryInput[];
  expenses: readonly ExpenseInput[];
}

/**
 * Ärendefälten som sparas så yrkandet går att räkna om. En typ-alias (inte ett
 * interface) så den går att skicka som `Partial<Matter>` (index-signaturen).
 */
export type KrRunMatterPatch = {
  isTaxeArende?: boolean;
  taxaLevel?: TaxaLevel;
  taxaHuvudforhandlingMin?: number;
  taxaHufStart?: Date;
};

/** Värderingen: brottmålstaxan (med belopp) eller normvägen (routern räknar). */
export type KrRunValuation =
  | { kind: "taxa"; grossOre: number; matterPatch: KrRunMatterPatch }
  | { kind: "norm"; matterPatch: KrRunMatterPatch };

const precondition = (message: string): TRPCError => new TRPCError({ code: "PRECONDITION_FAILED", message });

/** Taxeärende = offentligt uppdrag med taxan vald (dialogens val går före ärendets). */
function isTaxeClaim(matter: KrRunMatter, input: KrRunTaxaInput): boolean {
  return matter.paymentMethod === "OFFENTLIGT_UPPDRAG" && (input.isTaxeArende ?? matter.isTaxeArende === true);
}

/** Huvudförhandlingen: dialogens start/slut, annars ärendets sparade tid. Null = okänd. */
function huvudforhandling(matter: KrRunMatter, input: KrRunTaxaInput, now: Date): { start: Date; minutes: number } | null {
  if (input.hufStart && input.hufEnd) {
    const start = new Date(input.hufStart);
    return { start, minutes: Math.round((new Date(input.hufEnd).getTime() - start.getTime()) / 60_000) };
  }
  if (matter.taxaHuvudforhandlingMin == null) return null;
  return { start: matter.taxaHufStart ? new Date(matter.taxaHufStart) : now, minutes: matter.taxaHuvudforhandlingMin };
}

/** En giltig huvudförhandling för taxan, annars ett tydligt fel. */
function validHuf(matter: KrRunMatter, input: KrRunTaxaInput, now: Date): { start: Date; minutes: number } {
  const huf = huvudforhandling(matter, input, now);
  if (!huf) throw precondition("Ange huvudförhandlingens tid — brottmålstaxan beräknas på den.");
  if (huf.minutes < 0) throw precondition("Huvudförhandlingen slutar före den börjar.");
  if (huf.minutes > TAXA_MAX_MINUTES) {
    throw precondition("Huvudförhandlingen överstiger taxans maxgräns (3 tim 45 min) — avmarkera taxeärende och räkna löpande (DVFS 2025:6 1 och 8 §§).");
  }
  return huf;
}

function taxaLevelOf(matter: KrRunMatter, input: KrRunTaxaInput): TaxaLevel {
  const level = input.taxaLevel ?? matter.taxaLevel ?? 1;
  return level === 2 || level === 3 || level === 4 ? level : 1;
}

/** Värdera körningen. Kastar PRECONDITION_FAILED när taxan inte kan räknas. */
export function valueKrRun(matter: KrRunMatter, work: KrRunWork, input: KrRunTaxaInput, now: Date): KrRunValuation {
  const dialogChoice: KrRunMatterPatch = input.isTaxeArende === undefined ? {} : { isTaxeArende: input.isTaxeArende };
  if (!isTaxeClaim(matter, input)) return { kind: "norm", matterPatch: dialogChoice };
  const huf = validHuf(matter, input, now);
  const taxaLevel = taxaLevelOf(matter, input);
  const grossOre = kostnadsrakningClaimInclVat({
    hufStart: huf.start,
    hufEnd: new Date(huf.start.getTime() + huf.minutes * 60_000),
    yrkandeDate: now,
    taxaLevel,
    hasFTax: input.hasFTax ?? matter.taxaHasFTax ?? true,
    isTaxeArende: true,
    timeEntries: [...work.timeEntries],
    expenses: [...work.expenses],
  });
  return {
    kind: "taxa", grossOre,
    matterPatch: { ...dialogChoice, taxaLevel, taxaHuvudforhandlingMin: huf.minutes, taxaHufStart: huf.start },
  };
}
