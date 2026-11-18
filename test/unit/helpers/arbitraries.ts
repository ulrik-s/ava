/**
 * Gemensamma generatorer för egenskapstesterna (fast-check, https://fast-check.dev).
 *
 * Beloppen är öre (heltal) som i resten av domänen. Gränserna är byråns
 * verklighet med god marginal, inte talområdets: en miljard kronor är redan
 * orealistiskt för en faktura, och långt därunder räknar flyttalsdivisionen i
 * avrundningen fortfarande exakt (se `whole-kronor.ts`).
 */

import { Temporal } from "@js-temporal/polyfill";
import fc from "fast-check";
import type { Forhor } from "@/lib/shared/forordnandetaxa";
import { amountRoundingSchema, type AmountRounding } from "@/lib/shared/schemas/enums";
import { VAT_RATES, type VatRate } from "@/lib/shared/vat";

/** Största belopp generatorerna ger: en miljard kronor, i öre. */
export const MAX_ORE = 100_000_000_000;

/** Ett belopp i öre, 0 till en miljard kronor. */
export const oreAmount: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_ORE });

/** Ett belopp i öre med tecken — krediteringar är negativa. */
export const signedOre: fc.Arbitrary<number> = fc.integer({ min: -MAX_ORE, max: MAX_ORE });

/** Ett belopp i hela kronor (öre delbart med 100), som AVA:s egna rader sedan #1438. */
export const wholeKronor: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_ORE / 100 }).map((kr) => kr * 100);

/** En av de svenska momssatserna i basis points (0/600/1200/2500). */
export const vatRate: fc.Arbitrary<VatRate> = fc.constantFrom(...VAT_RATES);

/** Fakturans avrundningssätt: hela kronor (nya) eller öre (äldre fakturor). */
export const rounding: fc.Arbitrary<AmountRounding> = fc.constantFrom(...amountRoundingSchema.options);

/**
 * Ett yrkandedatum under ett av de år normerna finns för, eller året efter
 * (okänt år → senaste normen). Hela sekunder räcker — normen byts per dygn.
 */
export const yrkandeDate: fc.Arbitrary<Date> = fc.date({
  min: new Date("2024-12-31T00:00:00Z"),
  max: new Date("2027-12-31T23:59:59Z"),
  noInvalidDate: true,
});

const HOUR_MS = 3_600_000;

/**
 * En tidpunkt högst tre timmar från svensk midnatt på nyårsnatten — där UTC
 * och Stockholm är på olika ÅR (#1350, #1677). Nyår är alltid vintertid (+01).
 */
export function nearStockholmNewYear(minYear: number, maxYear: number): fc.Arbitrary<Date> {
  return fc.tuple(fc.integer({ min: minYear, max: maxYear }), fc.integer({ min: -3 * HOUR_MS, max: 3 * HOUR_MS }))
    .map(([year, offset]) => new Date(Date.UTC(year - 1, 11, 31, 23) + offset));
}

const MINUTE_MS = 60_000;

/**
 * Ett förhör: start en hel minut på en svensk dag 2025–2027 (sommar- och
 * vintertid, dygnets alla timmar), 0–10 h långt, med 0–3 uppehåll inuti.
 */
export const forhor: fc.Arbitrary<Forhor> = fc
  .record({
    day: fc.integer({ min: 0, max: 3 * 365 }),
    startMinute: fc.integer({ min: 0, max: 24 * 60 - 1 }),
    length: fc.integer({ min: 0, max: 600 }),
    pauses: fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 60 })), { maxLength: 3 }),
  })
  .map(({ day, startMinute, length, pauses }) => {
    const start = Temporal.PlainDate.from("2025-01-01").add({ days: day })
      .toPlainDateTime({ hour: Math.floor(startMinute / 60), minute: startMinute % 60 })
      .toZonedDateTime("Europe/Stockholm").epochMilliseconds;
    const at = (minute: number): Date => new Date(start + minute * MINUTE_MS);
    const within = (offset: number): number => offset % (length + 1);
    return {
      start: at(0),
      end: at(length),
      pauses: pauses.map(([offset, len]) => ({ start: at(within(offset)), end: at(within(offset) + len) })),
    };
  });

/** Summan av en lista tal — beloppens "summan av delarna". */
export const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** Hela kronor? */
export const isWholeKronor = (ore: number): boolean => ore % 100 === 0;
