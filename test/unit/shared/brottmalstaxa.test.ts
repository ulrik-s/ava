/**
 * Tester för brottmålstaxa. Belopp jämförs i öre.
 *
 * Källor: DVFS 2024:17 Bilaga (yrkanden under 2025) och DVFS 2025:6 Bilaga
 * (yrkanden från 2026-01-01). Spot-checks från tabellerna + edge cases. Taxan
 * är årsindexerad (#1004) — strukturtesterna körs därför mot VARJE årgång, inte
 * bara den senaste.
 */

import { describe, it, expect } from "vitest-compat";
import {
  computeBrottmalstaxa,
  computeTimkostnadsnorm,
  BROTTMALSTAXA_TABLE,
  BROTTMALSTAXA_TABLE_BY_YEAR,
  TAXA_MAX_MINUTES,
  TIMKOSTNADSNORM_FTAX_ORE_PER_H,
  TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H,
  applyNoFTaxFactor,
  brottmalstaxaTableForDate,
} from "@/lib/shared/brottmalstaxa";

describe("computeBrottmalstaxa — spot checks från DVFS 2025:6", () => {
  // Nivå 1, 0-14 min → 2809 kr ex moms
  it("HUF 0 min, nivå 1, F-skatt → 2809 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1 });
    expect(r.kind).toBe("taxa-applies");
    expect(r.ersattningExclVat).toBe(280900);
    expect(r.gransvardeExclVat).toBe(421900);
    expect(r.intervalLabel).toBe("0-14 min");
  });

  it("HUF 14 min (slutet av intervallet) → samma som 0", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 14, level: 1 });
    expect(r.ersattningExclVat).toBe(280900);
  });

  it("HUF 15 min → hopp till nästa intervall (15-29 min, 2980 kr)", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 15, level: 1 });
    expect(r.ersattningExclVat).toBe(298000);
    expect(r.intervalLabel).toBe("15-29 min");
  });

  // Nivå 1, mellanintervall
  it("HUF 1 tim 30 min (90 min), nivå 1 → 5635 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 1 });
    expect(r.ersattningExclVat).toBe(563500);
    expect(r.intervalLabel).toBe("1 tim 30 min - 1 tim 44 min");
  });

  // Nivå 2 (häktningsförhandling)
  it("HUF 90 min, nivå 2 → 7011 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 2 });
    expect(r.ersattningExclVat).toBe(701100);
  });

  // Nivå 3 (RPU)
  it("HUF 90 min, nivå 3 → 8296 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 3 });
    expect(r.ersattningExclVat).toBe(829600);
  });

  // Nivå 4 (häktning + RPU)
  it("HUF 90 min, nivå 4 → 9672 kr", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 90, level: 4 });
    expect(r.ersattningExclVat).toBe(967200);
  });

  // Sista intervallet
  it("HUF 225 min (3 tim 45 min), nivå 1 → 9887 kr (taxans tak)", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 225, level: 1 });
    expect(r.kind).toBe("taxa-applies");
    expect(r.ersattningExclVat).toBe(988700);
    expect(r.intervalLabel).toBe("3 tim 30 min - 3 tim 45 min");
  });

  it("HUF 226 min → exceeds-max", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 226, level: 1 });
    expect(r.kind).toBe("exceeds-max");
    expect(r.notes.join(" ")).toMatch(/tillämpas inte/);
  });

  it("Stort HUF (8 timmar) → exceeds-max", () => {
    expect(computeBrottmalstaxa({ huvudforhandlingMinutes: 480, level: 4 }).kind).toBe("exceeds-max");
  });
});

describe("F-skatt-justering", () => {
  it("hasFTax=false → multiplicerar med 1237/1626", () => {
    const withFTax = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, hasFTax: true });
    const withoutFTax = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, hasFTax: false });
    const expected = Math.round((withFTax.ersattningExclVat * 1237) / 1626);
    expect(withoutFTax.ersattningExclVat).toBe(expected);
    expect(withoutFTax.notes.join(" ")).toMatch(/F-skatt/);
  });

  it("applyNoFTaxFactor — 2809 kr × 1237/1626 = ca 2137 kr", () => {
    // 280900 * 1237 / 1626 = 213697.59... → 213698 öre
    expect(applyNoFTaxFactor(280900)).toBe(213698);
  });
});

describe("computeTimkostnadsnorm (löpande räkning > taxetak / non-taxemål)", () => {
  it("F-skatt (default): 60 min arbete → 1 626 kr, rate 162600 öre/h", () => {
    const r = computeTimkostnadsnorm({ arbetsMinutes: 60 });
    expect(r.rateOrePerH).toBe(TIMKOSTNADSNORM_FTAX_ORE_PER_H);
    expect(r.arbete).toBe(162_600);
    expect(r.tidsspillan).toBe(0);
    expect(r.total).toBe(162_600);
  });

  it("utan F-skatt: lägre timkostnadsnorm (1 237 kr/h)", () => {
    const r = computeTimkostnadsnorm({ arbetsMinutes: 60, hasFTax: false });
    expect(r.rateOrePerH).toBe(TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H);
    expect(r.arbete).toBe(123_700);
  });

  it("tidsspillan ersätts med samma norm och adderas till total", () => {
    const r = computeTimkostnadsnorm({ arbetsMinutes: 30, tidsspillanMinutes: 30 });
    expect(r.arbete).toBe(Math.round((30 * TIMKOSTNADSNORM_FTAX_ORE_PER_H) / 60));
    expect(r.tidsspillan).toBe(Math.round((30 * TIMKOSTNADSNORM_FTAX_ORE_PER_H) / 60));
    expect(r.total).toBe(r.arbete + r.tidsspillan);
  });

  it("avrundar till hela ören (1 min)", () => {
    const r = computeTimkostnadsnorm({ arbetsMinutes: 1 });
    expect(r.arbete).toBe(Math.round(TIMKOSTNADSNORM_FTAX_ORE_PER_H / 60));
  });

  it("0 min → 0 kr", () => {
    expect(computeTimkostnadsnorm({ arbetsMinutes: 0 }).total).toBe(0);
  });
});

describe("buildNotes-grenar", () => {
  it("nära intervallets övre gräns → varningsnot om avslutsklockslag", () => {
    // 12 min ligger i 0-14-intervallet, > toMin-5 (=9) → noten ska finnas.
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 12, level: 1 });
    expect(r.notes.join(" ")).toMatch(/övre gräns/i);
  });

  it("mitt i intervallet → ingen övre-gräns-not", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 2, level: 1 });
    expect(r.notes.join(" ")).not.toMatch(/övre gräns/i);
  });

  it("gränsvärdet F-skatt-justeras också utan F-skatt", () => {
    const withoutFTax = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, hasFTax: false });
    expect(withoutFTax.gransvardeExclVat).toBe(applyNoFTaxFactor(421900));
  });
});

describe("Validering", () => {
  it("negativ HUF → invalid-input", () => {
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: -1, level: 1 });
    expect(r.kind).toBe("invalid-input");
  });

  it("nivå 5 → invalid-input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = computeBrottmalstaxa({ huvudforhandlingMinutes: 60, level: 5 as any });
    expect(r.kind).toBe("invalid-input");
  });

  it("NaN HUF → invalid-input", () => {
    expect(computeBrottmalstaxa({ huvudforhandlingMinutes: NaN, level: 1 }).kind).toBe("invalid-input");
  });
});

/**
 * Taxans ÅRSDIMENSION (#1004) — samma buggklass som #980.
 *
 * Övergångsbestämmelserna (DVFS 2025:6 p. 3, samma lydelse i 2024:17) knyter
 * ersättningen till NÄR YRKANDET FRAMSTÄLLS, inte till när förhandlingen hölls:
 *
 *   "Äldre föreskrifter gäller fortfarande i fråga om yrkande om ersättning
 *    … som framställs före den 1 januari 2026."
 *
 * Alltså måste varje årgång ligga kvar och väljas på yrkandedatumet.
 */
describe("brottmålstaxans årgångar (#1004)", () => {
  /** Samma förhandling: 1 tim 30 min, nivå 1 — bara yrkandedatumet skiljer. */
  const huf90 = { huvudforhandlingMinutes: 90, level: 1 } as const;

  it("samma förhandling ger OLIKA belopp på var sin sida om årsskiftet", () => {
    const yrkat2025 = computeBrottmalstaxa({ ...huf90, yrkandeDate: "2025-12-20" });
    const yrkat2026 = computeBrottmalstaxa({ ...huf90, yrkandeDate: "2026-01-10" });
    expect(yrkat2025.ersattningExclVat).toBe(549_500); // 5 495 kr (DVFS 2024:17)
    expect(yrkat2026.ersattningExclVat).toBe(563_500); // 5 635 kr (DVFS 2025:6)
    expect(yrkat2026.ersattningExclVat).toBeGreaterThan(yrkat2025.ersattningExclVat);
    // Intervallindelningen är densamma — det är beloppen som byts.
    expect(yrkat2025.intervalLabel).toBe(yrkat2026.intervalLabel);
  });

  it("gränsvärdet följer med årgången", () => {
    expect(computeBrottmalstaxa({ ...huf90, yrkandeDate: "2025-12-20" }).gransvardeExclVat).toBe(825_100);
    expect(computeBrottmalstaxa({ ...huf90, yrkandeDate: "2026-01-10" }).gransvardeExclVat).toBe(846_100);
  });

  it("spot-check 2025: 0 min nivå 1 → 2 739 kr, 3 tim 45 min nivå 1 → 9 642 kr", () => {
    const kort = computeBrottmalstaxa({ huvudforhandlingMinutes: 0, level: 1, yrkandeDate: "2025-06-01" });
    expect(kort.ersattningExclVat).toBe(273_900);
    expect(kort.gransvardeExclVat).toBe(411_500);
    const lang = computeBrottmalstaxa({ huvudforhandlingMinutes: 225, level: 4, yrkandeDate: "2025-06-01" });
    expect(lang.ersattningExclVat).toBe(1_357_900); // 13 579 kr, nivå 4
  });

  it("utan F-skatt används ÅRETS kvot — 1207/1586 för 2025, 1237/1626 för 2026", () => {
    const r2025 = computeBrottmalstaxa({ ...huf90, hasFTax: false, yrkandeDate: "2025-12-20" });
    const r2026 = computeBrottmalstaxa({ ...huf90, hasFTax: false, yrkandeDate: "2026-01-10" });
    expect(r2025.ersattningExclVat).toBe(Math.round((549_500 * 1207) / 1586));
    expect(r2026.ersattningExclVat).toBe(Math.round((563_500 * 1237) / 1626));
    expect(r2025.notes.join(" ")).toMatch(/1207\/1586/);
    expect(r2026.notes.join(" ")).toMatch(/1237\/1626/);
  });

  it("utelämnat yrkandedatum → senaste årgången (bakåtkompatibelt)", () => {
    expect(computeBrottmalstaxa(huf90).ersattningExclVat)
      .toBe(computeBrottmalstaxa({ ...huf90, yrkandeDate: "2026-01-10" }).ersattningExclVat);
  });

  it("år bortom tabellen faller tillbaka på den senaste årgången", () => {
    // 2027 års föreskrift finns inte ännu — då är senaste kända taxan bästa
    // gissningen, precis som för timkostnadsnormen (#891).
    expect(brottmalstaxaTableForDate("2027-03-01")).toBe(BROTTMALSTAXA_TABLE);
    expect(brottmalstaxaTableForDate(undefined)).toBe(BROTTMALSTAXA_TABLE);
    expect(brottmalstaxaTableForDate(new Date("2025-06-01"))).not.toBe(BROTTMALSTAXA_TABLE);
  });

  it("BROTTMALSTAXA_TABLE är 2026 års årgång", () => {
    expect(BROTTMALSTAXA_TABLE).toBe(BROTTMALSTAXA_TABLE_BY_YEAR[2026]);
  });
});

describe.each(Object.entries(BROTTMALSTAXA_TABLE_BY_YEAR))("Tabellintegritet — %s års taxa", (_year, table) => {
  it("har 15 intervaller (0-14 till 210-225)", () => {
    expect(table).toHaveLength(15);
  });

  it("varje intervall är 15 min (utom sista som är 16 = 210-225)", () => {
    for (const r of table) {
      const width = r.toMin - r.fromMin + 1;
      expect(width === 15 || (r.fromMin === 210 && width === 16)).toBe(true);
    }
  });

  it("intervallen är sammanhängande (ingen lucka)", () => {
    for (let i = 1; i < table.length; i++) {
      expect(table[i]!.fromMin).toBe(table[i - 1]!.toMin + 1);
    }
  });

  it("täcker exakt 0 till TAXA_MAX_MINUTES", () => {
    expect(table[0]!.fromMin).toBe(0);
    expect(table[table.length - 1]!.toMin).toBe(TAXA_MAX_MINUTES);
  });

  it("ersättning ökar monotont per nivå inom varje intervall", () => {
    for (const r of table) {
      expect(r.ersattning[1]).toBeGreaterThan(r.ersattning[0]);
      expect(r.ersattning[2]).toBeGreaterThan(r.ersattning[1]);
      expect(r.ersattning[3]).toBeGreaterThan(r.ersattning[2]);
    }
  });

  it("ersättning ökar monotont mellan intervaller (nivå 1)", () => {
    for (let i = 1; i < table.length; i++) {
      expect(table[i]!.ersattning[0]).toBeGreaterThan(table[i - 1]!.ersattning[0]!);
    }
  });

  it("gränsvärdet är alltid större än ersättningen", () => {
    for (const r of table) {
      for (let lvl = 0; lvl < 4; lvl++) {
        expect(r.gransvarde[lvl]).toBeGreaterThan(r.ersattning[lvl]!);
      }
    }
  });

  it("intervallindelningen är identisk med den senaste årgången", () => {
    // Bara beloppen ändras mellan åren; skulle indelningen ändras måste
    // uppslagningen göras om, inte bara tabellen bytas.
    expect(table.map((r) => r.label)).toEqual(BROTTMALSTAXA_TABLE.map((r) => r.label));
  });
});
