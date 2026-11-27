/**
 * Egenskapstester (fast-check) för Domstolsverkets taxor: brottmålstaxan
 * (`brottmalstaxa.ts`), förordnandetaxan (`forordnandetaxa.ts`, DVFS 2025:5) och
 * timkostnadsnormen.
 *
 * Reglerna som prövas över tusentals genererade fall: mer tid ger aldrig mindre
 * ersättning, en högre nivå aldrig mindre, biträdet utan F-skatt får aldrig mer
 * än med, delarna summerar till helheten — och årgången väljs på den SVENSKA
 * kalenderdagen (#1350/#1677), också på nyårsnatten.
 */

import { Temporal } from "@js-temporal/polyfill";
import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import {
  applyNoFTaxFactorForDate, computeBrottmalstaxa, computeTimkostnadsnorm, coverageEntryValueOre,
  payableCoverageEntries, TAXA_MAX_MINUTES, type TaxaLevel, type TaxaResult,
} from "@/lib/shared/billing/brottmalstaxa";
import {
  computeForordnandeErsattning, forhorMinutes, isWithinTaxaHours, tidsspillanUtover, type Forhor,
} from "@/lib/shared/billing/forordnandetaxa";
import { timeEntryKindSchema } from "@/lib/shared/schemas/enums";
import { stockholmDay, stockholmYear } from "@/lib/shared/stockholm-time";
import { forhor, nearStockholmNewYear, oreAmount, yrkandeDate } from "../../helpers/arbitraries";

const level = fc.constantFrom<TaxaLevel>(1, 2, 3, 4);
/**
 * Förhandlingstiden i HELA minuter — det enda anroparna skickar
 * (`diffMinutes` golvar, `forhorMinutes` avrundar). Tabellens intervall är
 * heltal (0–14, 15–29, …), så 14,5 min faller mellan två rader.
 */
const taxaMinutes = fc.integer({ min: 0, max: TAXA_MAX_MINUTES });
const hasFTax = fc.boolean();

const taxa = (minutes: number, l: TaxaLevel, fTax: boolean, date: Date | string): TaxaResult =>
  computeBrottmalstaxa({ huvudforhandlingMinutes: minutes, level: l, hasFTax: fTax, yrkandeDate: date });

/**
 * Kvoten för biträde utan F-skatt — timkostnadsnormen utan/med F-skatt per år
 * (källorna står i `brottmalstaxa.ts`). Okänt år → senaste kända. Skriven för
 * hand här, som facit till `applyNoFTaxFactorForDate`.
 */
const NO_FTAX_QUOTIENT: Readonly<Record<number, readonly [number, number]>> = { 2025: [1207, 1586], 2026: [1237, 1626] };
const quotientFor = (date: Date): readonly [number, number] => NO_FTAX_QUOTIENT[stockholmYear(date)] ?? [1237, 1626];

describe("brottmalstaxa — taxetabellen", () => {
  it("varje hel minut 0–225 har en taxa > 0 och gränsvärdet ligger över ersättningen", () => {
    fc.assert(fc.property(taxaMinutes, level, hasFTax, yrkandeDate, (m, l, f, d) => {
      const r = taxa(m, l, f, d);
      expect(r.kind).toBe("taxa-applies");
      expect(r.ersattningExclVat).toBeGreaterThan(0);
      expect(r.gransvardeExclVat).toBeGreaterThan(r.ersattningExclVat);
    }));
  });

  it("över 3 h 45 min tillämpas taxan inte, och ger då inget taxebelopp", () => {
    fc.assert(fc.property(fc.integer({ min: TAXA_MAX_MINUTES + 1, max: 100_000 }), level, yrkandeDate, (m, l, d) => {
      const r = taxa(m, l, true, d);
      expect({ kind: r.kind, ersattning: r.ersattningExclVat }).toEqual({ kind: "exceeds-max", ersattning: 0 });
    }));
  });

  it("längre förhandling ger aldrig lägre ersättning eller gränsvärde", () => {
    fc.assert(fc.property(taxaMinutes, taxaMinutes, level, hasFTax, yrkandeDate, (a, b, l, f, d) => {
      const lo = taxa(Math.min(a, b), l, f, d);
      const hi = taxa(Math.max(a, b), l, f, d);
      expect(lo.ersattningExclVat).toBeLessThanOrEqual(hi.ersattningExclVat);
      expect(lo.gransvardeExclVat).toBeLessThanOrEqual(hi.gransvardeExclVat);
    }));
  });

  it("en högre nivå (häktning, RPU) ger alltid mer", () => {
    fc.assert(fc.property(taxaMinutes, level, level, hasFTax, yrkandeDate, (m, a, b, f, d) => {
      fc.pre(a < b);
      expect(taxa(m, a, f, d).ersattningExclVat).toBeLessThan(taxa(m, b, f, d).ersattningExclVat);
      expect(taxa(m, a, f, d).gransvardeExclVat).toBeLessThan(taxa(m, b, f, d).gransvardeExclVat);
    }));
  });

  it("utan F-skatt: aldrig mer än med, och exakt årets kvot avrundad till öre", () => {
    fc.assert(fc.property(taxaMinutes, level, yrkandeDate, (m, l, d) => {
      const med = taxa(m, l, true, d).ersattningExclVat;
      const utan = taxa(m, l, false, d).ersattningExclVat;
      const [num, den] = quotientFor(d);
      expect(utan).toBeLessThan(med);
      expect(Math.abs(utan * den - med * num)).toBeLessThanOrEqual(den / 2);
    }));
  });

  it("årgången väljs på den svenska kalenderdagen, även på nyårsnatten", () => {
    fc.assert(fc.property(nearStockholmNewYear(2025, 2027), taxaMinutes, level, hasFTax, (instant, m, l, f) => {
      expect(taxa(m, l, f, instant)).toEqual(taxa(m, l, f, stockholmDay(instant)));
    }));
  });
});

describe("timkostnadsnormen och F-skattekvoten", () => {
  const minutes = fc.integer({ min: 0, max: 100_000 });

  it("arbete + tidsspillan = totalen; mer tid ger aldrig mindre; utan F-skatt aldrig mer", () => {
    fc.assert(fc.property(minutes, minutes, minutes, hasFTax, (arbete, ts, extra, f) => {
      const r = computeTimkostnadsnorm({ arbetsMinutes: arbete, tidsspillanMinutes: ts, hasFTax: f });
      expect(r.total).toBe(r.arbete + r.tidsspillan);
      expect(computeTimkostnadsnorm({ arbetsMinutes: arbete + extra, tidsspillanMinutes: ts, hasFTax: f }).total).toBeGreaterThanOrEqual(r.total);
      expect(computeTimkostnadsnorm({ arbetsMinutes: arbete, tidsspillanMinutes: ts, hasFTax: false }).total)
        .toBeLessThanOrEqual(computeTimkostnadsnorm({ arbetsMinutes: arbete, tidsspillanMinutes: ts, hasFTax: true }).total);
    }));
  });

  it("kvoten sänker beloppet, aldrig under noll, och är monoton", () => {
    fc.assert(fc.property(oreAmount, oreAmount, yrkandeDate, (a, b, d) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(applyNoFTaxFactorForDate(lo, d)).toBeGreaterThanOrEqual(0);
      expect(applyNoFTaxFactorForDate(lo, d)).toBeLessThanOrEqual(lo);
      expect(applyNoFTaxFactorForDate(lo, d)).toBeLessThanOrEqual(applyNoFTaxFactorForDate(hi, d));
    }));
  });
});

// ─── Täckningsärendenas poster ────────────────────────────────────────────

const kind = fc.constantFrom(...timeEntryKindSchema.options);

describe("coverageEntryValueOre — en posts värde", () => {
  it("mer tid ger aldrig mindre; beredskapen är ett dygnsbelopp oavsett tid", () => {
    const minutes = fc.integer({ min: 0, max: 10_000 });
    fc.assert(fc.property(kind, minutes, minutes, yrkandeDate, (k, a, b, d) => {
      const value = (m: number): number => coverageEntryValueOre({ date: d, minutes: m, kind: k }, d);
      expect(value(Math.min(a, b))).toBeGreaterThanOrEqual(0);
      expect(value(Math.min(a, b))).toBeLessThanOrEqual(value(Math.max(a, b)));
      if (k === "ADVOKATBEREDSKAP") expect(value(a)).toBe(value(b));
    }));
  });
});

/** En post en av sju dagar runt sommartidens början 2026 (29/3) — täta krockar på samma dag. */
const coverageEntry = fc.record({
  id: fc.nat(),
  date: fc.date({ min: new Date("2026-03-26T00:00:00Z"), max: new Date("2026-04-02T00:00:00Z"), noInvalidDate: true }),
  minutes: fc.integer({ min: 0, max: 600 }),
  kind,
  billable: fc.boolean(),
});

describe("payableCoverageEntries — beredskap som förbrukats av arbete (DVFS 2025:9 § 2)", () => {
  it("tar bort exakt de beredskapsdagar som har debiterbart obekvämt arbete samma svenska dag", () => {
    fc.assert(fc.property(fc.array(coverageEntry, { maxLength: 12 }), (entries) => {
      const worked = new Set(entries.filter((e) => e.kind === "ARBETE_OBEKVAM_TID" && e.billable).map((e) => stockholmDay(e.date)));
      const expected = entries.filter((e) => e.kind !== "ADVOKATBEREDSKAP" || !worked.has(stockholmDay(e.date)));
      const payable = payableCoverageEntries(entries);
      expect(payable).toEqual(expected);
      expect(payableCoverageEntries(payable)).toEqual(payable);
    }));
  });
});

// ─── Förordnandetaxan ─────────────────────────────────────────────────────

const zoned = (ms: number): Temporal.ZonedDateTime =>
  Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO("Europe/Stockholm");

/** Facit för 3 §, via Temporal i stället för `Intl.formatToParts`: vardag, samma dag, 07.00–18.00. */
function withinTaxaHoursOracle(f: Forhor): boolean {
  const s = zoned(new Date(f.start).getTime());
  const e = zoned(new Date(f.end).getTime());
  const minuteOf = (z: Temporal.ZonedDateTime): number => z.hour * 60 + z.minute;
  return s.dayOfWeek <= 5 && s.toPlainDate().equals(e.toPlainDate()) && minuteOf(s) >= 7 * 60 && minuteOf(e) <= 18 * 60;
}

const tidsspillan = fc.record({ vardagMinutes: fc.integer({ min: 0, max: 2_000 }), ovrigMinutes: fc.integer({ min: 0, max: 2_000 }) });

describe("forhorMinutes — förhörstiden (5 §)", () => {
  it("aldrig negativ och aldrig mer än förhörets längd; korta uppehåll räknas in", () => {
    fc.assert(fc.property(forhor, (f) => {
      const full = forhorMinutes({ start: f.start, end: f.end });
      const short = (f.pauses ?? []).filter((p) => forhorMinutes({ start: p.start, end: p.end }) < 15);
      expect(forhorMinutes(f)).toBeGreaterThanOrEqual(0);
      expect(forhorMinutes(f)).toBeLessThanOrEqual(full);
      expect(forhorMinutes({ ...f, pauses: [...(f.pauses ?? []), ...short] })).toBe(forhorMinutes(f));
    }));
  });
});

describe("isWithinTaxaHours — förhör på vardagar 07.00–18.00 (3 §)", () => {
  it("stämmer med svensk tid räknad oberoende (Temporal), över sommar- och vintertid", () => {
    fc.assert(fc.property(forhor, (f) => {
      expect(isWithinTaxaHours(f)).toBe(withinTaxaHoursOracle(f));
    }));
  });
});

describe("tidsspillanUtover — timmen som ingår i taxan (8 §)", () => {
  it("högst en timme ingår, i första hand annan tid; ingår + utöver = registrerat", () => {
    fc.assert(fc.property(tidsspillan, hasFTax, yrkandeDate, (t, f, d) => {
      const r = tidsspillanUtover(t, d, f);
      expect(r.ingarOvrigMinutes + r.ingarVardagMinutes).toBe(Math.min(60, t.vardagMinutes + t.ovrigMinutes));
      expect(r.ingarOvrigMinutes).toBe(Math.min(60, t.ovrigMinutes));
      expect(r.ingarVardagMinutes + r.extraVardagMinutes).toBe(t.vardagMinutes);
      expect(r.ingarOvrigMinutes + r.extraOvrigMinutes).toBe(t.ovrigMinutes);
      expect(r.amountOre).toBeGreaterThanOrEqual(0);
    }));
  });

  it("mer tidsspillan ger aldrig mindre, och utan F-skatt aldrig mer än med", () => {
    fc.assert(fc.property(tidsspillan, tidsspillan, yrkandeDate, (a, extra, d) => {
      const more = { vardagMinutes: a.vardagMinutes + extra.vardagMinutes, ovrigMinutes: a.ovrigMinutes + extra.ovrigMinutes };
      expect(tidsspillanUtover(more, d, true).amountOre).toBeGreaterThanOrEqual(tidsspillanUtover(a, d, true).amountOre);
      expect(tidsspillanUtover(a, d, false).amountOre).toBeLessThanOrEqual(tidsspillanUtover(a, d, true).amountOre);
    }));
  });
});

describe("computeForordnandeErsattning", () => {
  const input = fc.record({
    forhor: fc.array(forhor, { maxLength: 4 }),
    tidsspillan,
    yrkandeDate,
    skaligErsattningOre: fc.integer({ min: 0, max: 10_000_000 }),
  });

  it("taxa bara när alla förhör är inom tiden och sammanlagt ≤ 3 h 45 min; arvodet = taxan + tidsspillan", () => {
    fc.assert(fc.property(input, hasFTax, (i, f) => {
      const r = computeForordnandeErsattning({ ...i, hasFTax: f });
      const total = i.forhor.reduce((s, x) => s + forhorMinutes(x), 0);
      expect(r.forhorMinutes).toBe(total);
      expect(r.kind === "taxa").toBe(i.forhor.every(withinTaxaHoursOracle) && total <= TAXA_MAX_MINUTES);
      if (r.kind !== "taxa") return;
      expect(r.arvodeExclVat).toBe(r.taxa.ersattningExclVat + r.tidsspillan.amountOre);
      expect(r.gransvardeOverskrids).toBe(i.skaligErsattningOre > r.taxa.gransvardeExclVat);
    }));
  });

  it("utan F-skatt blir arvodet aldrig högre än med", () => {
    fc.assert(fc.property(input, (i) => {
      const med = computeForordnandeErsattning({ ...i, hasFTax: true });
      const utan = computeForordnandeErsattning({ ...i, hasFTax: false });
      if (med.kind === "taxa" && utan.kind === "taxa") expect(utan.arvodeExclVat).toBeLessThanOrEqual(med.arvodeExclVat);
      else expect(utan.kind).toBe(med.kind);
    }));
  });
});
