/**
 * Settlement-vyns byggare (#1100).
 *
 * Vyn är EN källa för både faktura-dokumentet och Slutfaktura-sidan. Byggarna
 * låg i `routers/billingRun.ts` och kunde bara nås genom `settleCoverage` —
 * alltså bara med ett helt täckningsärende uppsatt. Nu går de att mata direkt,
 * och det är skillnaden mot router-testerna: de här kan ställa frågor om
 * ENSKILDA rader i trappan, inte bara om slutsumman.
 *
 * Trappan är det som juristen läser för att förstå varför fakturan blev som den
 * blev. Faller en rad bort ser totalen fortfarande rätt ut.
 */

import { describe, it, expect } from "vitest-compat";
import { asId } from "@/lib/shared/schemas/ids";
import {
  arvodeLadderRows, awardedBaseOre, buildClientArvodeLines, buildClientView, buildCreditView, buildPayerView, buildSettlementViews,
  creditPayload, feeBaseSuffix, ladderBaseOre, radgivningOre, shareLabel, svd,
  totalPrutningNetOre, vatLabel, type SettlementBreakdown,
} from "@/lib/shared/settlement-view";

/** En nedbrytning där varje fält är satt — testerna varierar ett i taget. */
function breakdown(o: Partial<SettlementBreakdown> = {}): SettlementBreakdown {
  return {
    clientShareBips: 2000,
    arvodeBaseNetOre: 100_000, baseArvodeGrossOre: 125_000,
    expensesGrossOre: 10_000, clientExpensesGrossOre: 2_000,
    expensesBaseNetOre: 8_000, expenseLossNetOre: 0,
    clientExpensesNetOre: 1_600, clientExpensesVatOre: 400,
    payerExpensesNetOre: 6_400, payerExpensesVatOre: 1_600,
    sjalvriskNetOre: 20_000, sjalvriskGrossOre: 25_000,
    firmLossNetOre: 0, prutningGrossOre: 0,
    payerArvodeNetOre: 80_000,
    radgivningGrossOre: 0, radgivningNetOre: 0,
    payerPayableOre: 88_000, clientPayableOre: 27_000,
    clientArvodeLines: [], deductedAccontos: [],
    ...o,
  };
}

describe("svd", () => {
  it("formaterar svenskt datum", () => {
    expect(svd("2026-03-09")).toBe("2026-03-09");
  });

  it("tomt för null och undefined — inte 'Invalid Date'", () => {
    expect(svd(null)).toBe("");
    expect(svd(undefined)).toBe("");
  });
});

describe("shareLabel", () => {
  it.each([[2000, "20"], [500, "5"], [4000, "40"], [1250, "12,5"]])(
    "%i bips → %s %%", (bips, expected) => {
      expect(shareLabel(bips)).toBe(expected);
    });
});

describe("radgivningOre", () => {
  // Den redan fakturerade rådgivningstimmen (#1205) — bara omnämnd, aldrig i underlaget.
  it("registrerad rådgivning → timmen brutto + netto (för omnämnandet)", () => {
    const r = radgivningOre(true, 162_600);
    expect(r.radgivningNetOre).toBe(162_600);
    expect(r.radgivningGrossOre).toBeGreaterThan(r.radgivningNetOre);
  });

  it("ingen rådgivningsfaktura → noll", () => {
    expect(radgivningOre(false, 162_600)).toEqual({ radgivningGrossOre: 0, radgivningNetOre: 0 });
  });
});

describe("arvodeLadderRows — rådgivningstimmen (#1205)", () => {
  it("toppraden är det upparbetade (ofrysta) arvodet — rådgivningen läggs varken till eller dras av", () => {
    const rows = arvodeLadderRows(breakdown({ radgivningNetOre: 162_600, radgivningGrossOre: 203_250 }), "Domstolens");
    expect(rows[0]).toEqual({ label: "Upparbetat arvode (exkl moms)", amountOre: 100_000, kind: "add" });
    expect(rows.some((r) => r.kind === "deduct")).toBe(false);
    expect(rows.some((r) => r.label.startsWith("Beviljat"))).toBe(false);
  });

  it("omnämner den redan fakturerade timmen som info-rad utan beloppspåverkan", () => {
    const rows = arvodeLadderRows(breakdown({ radgivningNetOre: 162_600, radgivningGrossOre: 203_250 }), "Domstolens");
    expect(rows.at(-1)).toEqual({
      label: "Rådgivningstimme (1 tim) har redan fakturerats klienten separat enligt rättshjälpstaxan och ingår ej i denna faktura.",
      amountOre: 162_600, kind: "info",
    });
  });

  it("ingen rådgivning → ingen info-rad", () => {
    expect(arvodeLadderRows(breakdown(), "Domstolens").some((r) => r.kind === "info")).toBe(false);
  });

  it("prutning → avdrag + beviljat belopp, rådgivningen påverkar inte basen", () => {
    const b = breakdown({ firmLossNetOre: 5_000, radgivningNetOre: 162_600 });
    const rows = arvodeLadderRows(b, "Domstolens");
    expect(rows.find((r) => r.label.startsWith("Beviljat"))?.amountOre).toBe(108_000 - 5_000);
  });
});

describe("buildClientArvodeLines (#1205)", () => {
  const entry = (id: string, date: string, minutes: number, kind: "ARBETE" | "TIDSSPILLAN" = "ARBETE") => ({
    id: asId<"TimeEntryId">(id), date, description: id, minutes, hourlyRate: 0, billable: true, kind,
  });

  it("ingen registrerad tid carvas bort — varken ärendets första timme eller tidsspillan", () => {
    const work = {
      timeEntries: [entry("ts", "2026-03-01", 42, "TIDSSPILLAN"), entry("a1", "2026-03-02", 390)],
      expenses: [],
    };
    const lines = buildClientArvodeLines(work, 0, "2026-06-01");
    expect(lines.map((l) => [l.description, l.minutes])).toEqual([["ts", 42], ["a1", 390]]);
  });

  it("stämmer av sista raden mot arvodesbasen och hoppar över icke-debiterbart", () => {
    const work = {
      timeEntries: [entry("a1", "2026-03-02", 60), { ...entry("x", "2026-03-03", 60), billable: false }],
      expenses: [],
    };
    const lines = buildClientArvodeLines(work, 162_601, "2026-06-01");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountOre).toBe(162_601);
  });

  it("tomt underlag → inga rader", () => {
    expect(buildClientArvodeLines({ timeEntries: [], expenses: [] }, 0, "2026-06-01")).toEqual([]);
  });
});

describe("trappans baser", () => {
  it("ladderBaseOre = arvodesbas + utlägg netto — utläggen ingår i det som prutas", () => {
    expect(ladderBaseOre(breakdown())).toBe(100_000 + 8_000);
  });

  it("totalPrutningNetOre summerar arvodets och utläggens nedsättning", () => {
    expect(totalPrutningNetOre(breakdown({ firmLossNetOre: 5_000, expenseLossNetOre: 400 }))).toBe(5_400);
  });

  it("awardedBaseOre drar av hela nedsättningen från basen", () => {
    const b = breakdown({ firmLossNetOre: 5_000, expenseLossNetOre: 400 });
    expect(awardedBaseOre(b)).toBe(ladderBaseOre(b) - 5_400);
  });

  it("utan nedsättning är beviljad bas = full bas", () => {
    const b = breakdown();
    expect(awardedBaseOre(b)).toBe(ladderBaseOre(b));
  });
});

describe("vatLabel", () => {
  it("namnger momsen med sitt belopp", () => {
    expect(vatLabel(100_000, 25_000)).toContain("25");
  });

  it("tål noll moms utan att dela med noll", () => {
    expect(() => vatLabel(0, 0)).not.toThrow();
  });
});

describe("feeBaseSuffix", () => {
  it("nämner nedsättningen när det finns en", () => {
    expect(feeBaseSuffix(breakdown({ firmLossNetOre: 5_000 }))).not.toBe("");
  });

  it("är tomt när inget prutats — ingen tom parentes i vyn", () => {
    expect(feeBaseSuffix(breakdown())).toBe("");
  });
});

describe("buildClientView", () => {
  const view = buildClientView(breakdown(), false, "självrisk");

  it("har rader och en total", () => {
    expect(view.rows.length).toBeGreaterThan(0);
    expect(typeof view.totalOre).toBe("number");
  });

  // Trappan är en HÄRLEDNING, inte en löpande summa: den innehåller
  // mellansummor ("Underlag exkl moms") och slutar på beloppet den förklarar.
  // Invarianten är därför sista raden — glider den isär från totalen visar vyn
  // en uträkning som inte leder till fakturans belopp.
  it("sista raden är beloppet vyn förklarar", () => {
    expect(view.rows.at(-1)?.amountOre).toBe(view.totalOre);
  });

  it("inga info-rader bär belopp — de är spårbarhet, inte steg", () => {
    for (const r of view.rows.filter((x) => x.kind === "info")) {
      expect(r.amountOre, r.label).toBe(0);
    }
  });

  it("rättshjälp och rättsskydd ger olika rubriksättning", () => {
    const rh = buildClientView(breakdown(), true, "rättshjälpsavgift");
    expect(JSON.stringify(rh.rows)).not.toBe(JSON.stringify(view.rows));
  });
});

describe("buildPayerView", () => {
  // Betalarens trappa slutar på ett BRUTTOunderlag medan totalen är nettot att
  // betala — till skillnad från klientvyn, som landar på sitt eget slutbelopp.
  it("totalen är payerPayableOre", () => {
    const b = breakdown();
    expect(buildPayerView(b, "Domstolen", "domstolen", "rättshjälpsavgift").totalOre).toBe(b.payerPayableOre);
  });

  it("klientens självrisk dras av i trappan", () => {
    const view = buildPayerView(breakdown(), "Domstolen", "domstolen", "rättshjälpsavgift");
    expect(view.rows.some((r) => r.kind === "deduct")).toBe(true);
  });
});

describe("buildSettlementViews", () => {
  it.each(["RATTSHJALP", "RATTSSKYDD"] as const)("%s ger både klient- och betalarvy", (m) => {
    const { clientView, payerView } = buildSettlementViews(breakdown(), m);
    expect(clientView.rows.length).toBeGreaterThan(0);
    expect(payerView.rows.length).toBeGreaterThan(0);
  });

  // Betalaren heter olika sak beroende på betalningssätt, och det syns i vyn.
  it("betalaren namnges efter betalningssätt", () => {
    const rh = buildSettlementViews(breakdown(), "RATTSHJALP").payerView;
    const rs = buildSettlementViews(breakdown(), "RATTSSKYDD").payerView;
    expect(JSON.stringify(rh)).not.toBe(JSON.stringify(rs));
  });
});

describe("buildCreditView", () => {
  it("vänder klientvyn till en kreditering", () => {
    const client = buildClientView(breakdown(), false, "självrisk");
    const credit = buildCreditView(client, 5_000);
    expect(credit.rows.length).toBeGreaterThanOrEqual(client.rows.length);
  });
});

describe("creditPayload", () => {
  // 100 000 netto + 25 000 moms = 125 000 brutto.
  const LINES = [{ kind: "arvode" as const, vatRate: 2500, netOre: 100_000, vatOre: 25_000 }];

  // `vatOre` är momsen som ÅTERSTÅR att fakturera efter avdragna aconton —
  // acontot har redan bokfört sin del (#968, modell A). Den sjunker därför när
  // avdraget växer, och vänder till kredit först när acontot överstiger fakturan.
  it("återstående moms sjunker när avdraget växer", () => {
    const v = [0, 50_000, 125_000, 200_000].map((d) => creditPayload(LINES, d).vatOre);
    expect(v).toEqual([...v].sort((a, b) => b - a));
  });

  it("avdrag = fakturans brutto lämnar exakt noll moms kvar", () => {
    // Math.abs: värdet är -0, och Object.is skiljer det från 0.
    expect(Math.abs(creditPayload(LINES, 125_000).vatOre)).toBe(0);
  });

  // Överbetalning är hela anledningen till att en kreditfaktura uppstår.
  it("avdrag ÖVER fakturan ger negativ moms — en verklig kreditering", () => {
    expect(creditPayload(LINES, 200_000).vatOre).toBeLessThan(0);
  });

  it("bär en moms-nedbrytning så krediteringen kan bokföras per sats", () => {
    expect(creditPayload(LINES, 50_000).vatBreakdown.length).toBeGreaterThan(0);
  });
});
