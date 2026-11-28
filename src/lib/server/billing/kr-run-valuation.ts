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
import { TAXA_MAX_MINUTES, type TaxaLevel } from "@/lib/shared/billing/brottmalstaxa";
import { forhorFromTimeEntries } from "@/lib/shared/billing/forordnandetaxa";
import { type ExpenseInput, kostnadsrakningClaimInclVat, type TimeEntryInput } from "@/lib/shared/billing/kostnadsrakning";
import type { ForordnandeAvslut } from "@/lib/shared/schemas/enums";

/** Det dialogen skickar med inskicket (allt valfritt: skript/demo saknar dialog). */
export interface KrRunTaxaInput {
  hufStart?: string | undefined;
  hufEnd?: string | undefined;
  taxaLevel?: TaxaLevel | undefined;
  /** Dialogens val; saknas → ärendets. */
  isTaxeArende?: boolean | undefined;
  /** Dialogens F-skatt; saknas → ärendets (default: F-skatt). */
  hasFTax?: boolean | undefined;
  /**
   * Förordnandemål (#1857): förundersökningens avslut, valt i dialogen. Bara då
   * räknas förordnandetaxan; servern väljer den aldrig själv.
   */
  forordnande?: { avslut: ForordnandeAvslut } | undefined;
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
 * Ärendefälten som sparas så yrkandet går att räkna om: nivån och
 * huvudförhandlingen (ADR 0034). Taxevalet är körningens och sparas inte på
 * ärendet (#1890). En typ-alias (inte ett interface) så den går att skicka som
 * `Partial<Matter>` (index-signaturen).
 */
export type KrRunMatterPatch = {
  taxaLevel?: TaxaLevel;
  taxaHuvudforhandlingMin?: number;
  taxaHufStart?: Date;
};

/**
 * Värderingen: brottmålstaxan, löpande räkning i offentligt uppdrag,
 * förordnandetaxan (alla med belopp, räknat som dialogens dokument) eller
 * normvägen (rättshjälp; routern räknar).
 */
export type KrRunValuation =
  | { kind: "taxa" | "lopande" | "forordnande"; grossOre: number; matterPatch: KrRunMatterPatch }
  | { kind: "norm"; matterPatch: KrRunMatterPatch };

const precondition = (message: string): TRPCError => new TRPCError({ code: "PRECONDITION_FAILED", message });

/** Taxeärende = offentligt uppdrag med taxan vald (dialogens val går före ärendets). */
function isTaxeClaim(matter: KrRunMatter, input: KrRunTaxaInput): boolean {
  return matter.paymentMethod === "OFFENTLIGT_UPPDRAG" && (input.isTaxeArende ?? matter.isTaxeArende === true);
}

/**
 * Löpande räkning i offentligt uppdrag (#1255): dialogens dokument tar med
 * huvudförhandlingens tid som arbete. Körningen räknas därför med samma funktion
 * och samma tid, annars yrkar dokumentet mer än körningen lagrar. Utan dialog
 * (skript, demo) finns ingen huvudförhandling att räkna med.
 */
function lopandeHuf(input: KrRunTaxaInput, now: Date): { start: Date; end: Date } {
  if (!input.hufStart || !input.hufEnd) return { start: now, end: now };
  const start = new Date(input.hufStart);
  const end = new Date(input.hufEnd);
  if (end < start) throw precondition("Huvudförhandlingen slutar före den börjar.");
  return { start, end };
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
  if (input.forordnande) return forordnandeValuation(matter, work, input, input.forordnande.avslut, now);
  if (matter.paymentMethod !== "OFFENTLIGT_UPPDRAG") return { kind: "norm", matterPatch: {} };
  if (!isTaxeClaim(matter, input)) return lopandeValuation(matter, work, input, now);
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
    matterPatch: { taxaLevel, taxaHuvudforhandlingMin: huf.minutes, taxaHufStart: huf.start },
  };
}

function lopandeValuation(matter: KrRunMatter, work: KrRunWork, input: KrRunTaxaInput, now: Date): KrRunValuation {
  const huf = lopandeHuf(input, now);
  const grossOre = kostnadsrakningClaimInclVat({
    hufStart: huf.start,
    hufEnd: huf.end,
    yrkandeDate: now,
    hasFTax: input.hasFTax ?? matter.taxaHasFTax ?? true,
    isTaxeArende: false,
    timeEntries: [...work.timeEntries],
    expenses: [...work.expenses],
  });
  return { kind: "lopande", grossOre, matterPatch: {} };
}

/**
 * Förordnandemål (#1857, ADR 0034): yrkandet på förordnandetaxan med ärendets
 * förhör (tidsposterna med kategorin FORHOR bland de ofrysta posterna), samma
 * funktion och samma förhör som dokumentet. Utan förhör ger domänen taxans
 * lägsta belopp (6 §). Huvudförhandlingen används inte, och ärendet ändras inte.
 */
function forordnandeValuation(
  matter: KrRunMatter, work: KrRunWork, input: KrRunTaxaInput, avslut: ForordnandeAvslut, now: Date,
): KrRunValuation {
  if (matter.paymentMethod !== "OFFENTLIGT_UPPDRAG") {
    throw precondition("Förordnandetaxan gäller bara offentligt uppdrag.");
  }
  const grossOre = kostnadsrakningClaimInclVat({
    forordnande: { forhor: forhorFromTimeEntries(work.timeEntries), avslut },
    yrkandeDate: now,
    hasFTax: input.hasFTax ?? matter.taxaHasFTax ?? true,
    isTaxeArende: true,
    timeEntries: [...work.timeEntries],
    expenses: [...work.expenses],
  });
  return { kind: "forordnande", grossOre, matterPatch: {} };
}

/**
 * Körningens typade avslut (#2180): förordnandemålets avslut, i egen kolumn så
 * att det går att fråga på. Sedan contract-steget (#2192) står det bara där.
 * Null utanför förordnandetaxan.
 */
export function krRunForordnandeAvslut(input: KrRunTaxaInput): ForordnandeAvslut | null {
  return input.forordnande?.avslut ?? null;
}

/**
 * Ärendet som körningen värderas på (#1890): det sparade, med värderingens
 * patch och dialogens taxeval ovanpå. Valet gäller bara körningen och skrivs
 * inte till ärendet, men normvägen räknar med det som förut.
 */
export function krRunValuedMatter<M extends object>(
  matter: M, valuation: KrRunValuation, input: KrRunTaxaInput,
): M & KrRunMatterPatch & { isTaxeArende?: boolean } {
  const choice = input.isTaxeArende === undefined ? {} : { isTaxeArende: input.isTaxeArende };
  return { ...matter, ...valuation.matterPatch, ...choice };
}

/** Det lagrade yrkandet: värderingens belopp, eller normvägens (routern räknar). */
export function krRunGrossOre(valuation: KrRunValuation, norm: () => number): number {
  switch (valuation.kind) {
    case "taxa":
    case "lopande":
    case "forordnande":
      return valuation.grossOre;
    case "norm":
      return norm();
    default: { const never: never = valuation; return never; }
  }
}
