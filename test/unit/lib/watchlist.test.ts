import { describe, it, expect } from "vitest-compat";
import {
  coverageItems, deadlineItems, failedDispatchItems, overdueInvoiceItems,
  sortWatchlist, unbilledItems, daysBetween,
  DEFAULT_THRESHOLDS, type WatchlistItem,
} from "@/lib/shared/watchlist";

const NOW = new Date("2026-09-05T00:00:00Z");

describe("daysBetween", () => {
  it("räknar hela dagar framåt", () => {
    expect(daysBetween(NOW, new Date("2026-09-12T00:00:00Z"))).toBe(7);
  });

  it("ger negativt för datum som passerat", () => {
    expect(daysBetween(NOW, new Date("2026-09-01T00:00:00Z"))).toBe(-4);
  });

  // Klockslag får inte påverka — annars flimrar "3 dagar kvar" beroende på
  // när på dygnet sidan laddas.
  it("bryr sig inte om klockslag", () => {
    expect(daysBetween(new Date("2026-09-05T23:59:00Z"), new Date("2026-09-06T00:01:00Z"))).toBe(1);
  });
});

describe("coverageItems", () => {
  const rattshjalp = {
    id: "m1", matterNumber: "2026-0001",
    method: "RATTSHJALP" as const, rattshjalpMaxTimmar: 100, rattsskyddMaxOre: null,
  };

  it("tiger under varningsgränsen", () => {
    // 50 h av 100 → inget att påminna om.
    expect(coverageItems([{ ...rattshjalp, billableMinutes: 3000, billableValueOre: 0 }])).toEqual([]);
  });

  it("varnar när taket närmar sig", () => {
    const [item] = coverageItems([{ ...rattshjalp, billableMinutes: 5_700, billableValueOre: 0 }]);
    expect(item?.severity).toBe("approaching");
    expect(item?.detail).toContain("utökad rättshjälp");
  });

  // Passerat tak är redan en förlust — det måste rangordnas högre än ett
  // annalkande, annars hamnar det under i listan.
  it("markerar passerat tak som passed", () => {
    const [item] = coverageItems([{ ...rattshjalp, billableMinutes: 6_600, billableValueOre: 0 }]);
    expect(item?.severity).toBe("passed");
    expect(item?.title).toContain("passerat");
  });

  it("talar om utökat RÄTTSSKYDD för rättsskyddsärenden", () => {
    const [item] = coverageItems([{
      id: "m2", matterNumber: "2026-0002", method: "RATTSSKYDD",
      rattsskyddMaxOre: 100_000_00, rattshjalpMaxTimmar: null,
      billableMinutes: 0, billableValueOre: 95_000_00,
    }]);
    expect(item?.detail).toContain("utökat rättsskydd");
  });
});

describe("unbilledItems", () => {
  const bas = { id: "m1", matterNumber: "2026-0001" };

  it("tiger under båda trösklarna", () => {
    const items = unbilledItems([{ ...bas, unbilledOre: 500_00, oldestEntryDate: "2026-09-01" }], NOW);
    expect(items).toEqual([]);
  });

  it("utlöser på BELOPP även när arbetet är färskt", () => {
    const items = unbilledItems([{ ...bas, unbilledOre: 30_000_00, oldestEntryDate: "2026-09-04" }], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toContain("över tröskeln");
  });

  // Den här fångar det beloppsgränsen missar: småärenden som glider bort.
  it("utlöser på ÅLDER även när beloppet är litet", () => {
    const items = unbilledItems([{ ...bas, unbilledOre: 800_00, oldestEntryDate: "2026-01-01" }], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toContain("dagar gammalt");
  });

  it("nämner båda skälen när båda gäller", () => {
    const items = unbilledItems([{ ...bas, unbilledOre: 30_000_00, oldestEntryDate: "2026-01-01" }], NOW);
    expect(items[0]?.detail).toContain("över tröskeln och");
  });

  it("ignorerar ärenden utan ofakturerat", () => {
    expect(unbilledItems([{ ...bas, unbilledOre: 0, oldestEntryDate: "2026-01-01" }], NOW)).toEqual([]);
  });

  it("respekterar överstyrda trösklar", () => {
    const strängare = { ...DEFAULT_THRESHOLDS, unbilledThresholdOre: 100_00, unbilledAgeDays: 9999 };
    const items = unbilledItems([{ ...bas, unbilledOre: 500_00, oldestEntryDate: "2026-09-01" }], NOW, strängare);
    expect(items).toHaveLength(1);
  });
});

describe("deadlineItems", () => {
  const bas = { id: "t1", title: "Ge in yttrande", matterId: "m1", matterNumber: "2026-0001" };

  it("ignorerar frister bortom horisonten", () => {
    expect(deadlineItems([{ ...bas, dueAt: "2026-12-01" }], NOW)).toEqual([]);
  });

  it("tar med frister inom horisonten", () => {
    const [item] = deadlineItems([{ ...bas, dueAt: "2026-09-10" }], NOW);
    expect(item?.severity).toBe("approaching");
    expect(item?.title).toContain("5 dagar");
  });

  it("markerar passerad frist och hur länge sedan", () => {
    const [item] = deadlineItems([{ ...bas, dueAt: "2026-09-01" }], NOW);
    expect(item?.severity).toBe("passed");
    expect(item?.detail).toContain("4 dagar sedan");
  });

  it("länkar till uppgiftslistan när fristen saknar ärende", () => {
    const [item] = deadlineItems([{ ...bas, matterId: null, matterNumber: null, dueAt: "2026-09-06" }], NOW);
    expect(item?.href).toBe("/tasks");
  });
});

describe("overdueInvoiceItems", () => {
  const bas = { id: "i1", invoiceNumber: "F-2026-0001", matterId: "m1", matterNumber: "2026-0001" };

  it("ignorerar fakturor som inte förfallit", () => {
    expect(overdueInvoiceItems([{ ...bas, dueDate: "2026-10-01", outstandingOre: 1_000_00 }], NOW)).toEqual([]);
  });

  // En betald faktura kan ha passerat förfallodagen utan att vara ett problem.
  it("ignorerar förfallna fakturor UTAN utestående", () => {
    expect(overdueInvoiceItems([{ ...bas, dueDate: "2026-08-01", outstandingOre: 0 }], NOW)).toEqual([]);
  });

  it("räknar dagar över förfallodag", () => {
    const [item] = overdueInvoiceItems([{ ...bas, dueDate: "2026-08-26", outstandingOre: 1_000_00 }], NOW);
    expect(item?.severity).toBe("passed");
    expect(item?.detail).toContain("10 dagar");
  });
});

describe("failedDispatchItems", () => {
  it("förklarar VARFÖR fakturan är obetald", () => {
    const [item] = failedDispatchItems([{
      invoiceId: "i1", invoiceNumber: "F-2026-0002", recipient: "klient@example.test",
      error: "550 rejected", failedAt: "2026-09-01", matterId: "m1", matterNumber: "2026-0001",
    }]);
    expect(item?.severity).toBe("passed");
    expect(item?.detail).toContain("550 rejected");
    expect(item?.detail).toContain("inte kommit fram");
  });

  it("klarar utskick utan felmeddelande", () => {
    const [item] = failedDispatchItems([{
      invoiceId: "i1", invoiceNumber: null, recipient: "x@y.test",
      error: null, failedAt: null, matterId: null, matterNumber: null,
    }]);
    expect(item?.detail).not.toContain("undefined");
  });
});

describe("sortWatchlist", () => {
  const item = (p: Partial<WatchlistItem>): WatchlistItem => ({
    kind: "deadline", severity: "approaching", title: "t", detail: "d",
    matterId: null, matterNumber: null, at: null, amountOre: null, href: "/", ...p,
  });

  it("sätter passerat före annalkande", () => {
    const out = sortWatchlist([item({ severity: "approaching" }), item({ severity: "passed" })]);
    expect(out[0]?.severity).toBe("passed");
  });

  it("sorterar äldst datum först inom samma allvarsgrad", () => {
    const out = sortWatchlist([
      item({ severity: "passed", at: "2026-09-03" }),
      item({ severity: "passed", at: "2026-08-01" }),
    ]);
    expect(out[0]?.at).toBe("2026-08-01");
  });

  // Ett belopp är angeläget men inte tidsstyrt — det får inte tränga undan
  // något som faktiskt har en förfallodag.
  it("lägger datumlösa poster sist inom sin grupp", () => {
    const out = sortWatchlist([
      item({ severity: "approaching", at: null, amountOre: 99_000_00 }),
      item({ severity: "approaching", at: "2026-09-10" }),
    ]);
    expect(out[0]?.at).toBe("2026-09-10");
  });

  it("sorterar datumlösa efter belopp, störst först", () => {
    const out = sortWatchlist([
      item({ severity: "approaching", amountOre: 100_00 }),
      item({ severity: "approaching", amountOre: 900_00 }),
    ]);
    expect(out[0]?.amountOre).toBe(900_00);
  });

  it("muterar inte indata", () => {
    const input = [item({ severity: "approaching" }), item({ severity: "passed" })];
    sortWatchlist(input);
    expect(input[0]?.severity).toBe("approaching");
  });
});
