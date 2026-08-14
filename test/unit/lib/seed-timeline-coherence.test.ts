/**
 * Seedens TIDSLINJE (#1021).
 *
 * `seed-invoice-coherence.test.ts` vaktar att beloppen går ihop — att en PAID
 * faktura är täckt av betalningar. Det här testet vaktar den andra halvan:
 * att händelserna kan ha inträffat i den ordning datan påstår.
 *
 * Bakgrunden är en granskning via MCP där varje fynd blev tvetydigt: en
 * betalning daterad tre månader före sin faktura, en fullbetald faktura utan
 * realiseringsdatum, och tomma `invoiceDispatch`/`billingRun` som inte gick
 * att skilja från verkliga luckor i byråns arbete. `buildSeed()` byggde
 * fakturor, planer och betalningar från var sin datumserie som aldrig möttes.
 */

import { describe, it, expect } from "vitest-compat";
import { buildSeed } from "@/../tooling/scripts/seed-data";

const seed = buildSeed();
const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const invoiceById = new Map(seed.invoices.map((i) => [String(i.id), i]));
const label = (row: Record<string, unknown>): string => `${String(row.id)} (${String(row.invoiceId ?? "")})`;

describe("betalningarnas tidslinje", () => {
  it("ingen betalning är daterad före sin fakturas utställning", () => {
    // Rotfyndet: pay-012 låg 2026-03-01 på en faktura utställd 2026-06-21.
    const tooEarly = seed.payments.filter((p) => {
      const inv = invoiceById.get(String(p.invoiceId));
      return inv !== undefined && asDate(p.paidAt).getTime() < asDate(inv.issuedAt).getTime();
    });
    expect(tooEarly.map(label), "betalning före sin faktura").toEqual([]);
  });

  it("ingen betalning ligger i framtiden", () => {
    const now = Date.now();
    const future = seed.payments.filter((p) => asDate(p.paidAt).getTime() > now);
    expect(future.map(label)).toEqual([]);
  });

  it("varje avbetalningsplan startar efter sin fakturas utställning", () => {
    for (const plan of seed.paymentPlans) {
      const inv = invoiceById.get(String(plan.invoiceId));
      if (!inv) continue;
      expect(
        asDate(plan.startDate).getTime(),
        `plan ${String(plan.id)} startar före faktura ${String(plan.invoiceId)}`,
      ).toBeGreaterThanOrEqual(asDate(inv.issuedAt).getTime());
    }
  });

  it("månadsbetalningarna är numrerade i kronologisk ordning", () => {
    // Numreringen gick förut baklänges: "Månadsbetalning 6" låg först.
    for (const plan of seed.paymentPlans) {
      const rows = seed.payments
        .filter((p) => p.invoiceId === plan.invoiceId && String(p.note).startsWith("Månadsbetalning"))
        .sort((a, b) => asDate(a.paidAt).getTime() - asDate(b.paidAt).getTime())
        .map((p) => Number(/Månadsbetalning (\d+)/.exec(String(p.note))?.[1] ?? 0));
      expect(rows, `plan ${String(plan.id)}`).toEqual([...rows].sort((a, b) => a - b));
    }
  });
});

describe("fullbetalda fakturor bär sitt realiseringsdatum", () => {
  const paid = seed.invoices.filter((i) => i.status === "PAID");

  it("seeden har fullbetalda fakturor att vakta", () => {
    expect(paid.length).toBeGreaterThan(0);
  });

  it("varje PAID-faktura har paidAt satt", () => {
    // Utan datum faller fakturan ur åldersanalysen (ADR 0007).
    expect(paid.filter((i) => !i.paidAt).map((i) => String(i.id))).toEqual([]);
  });

  it("paidAt ligger på eller efter utställningen, aldrig i framtiden", () => {
    const now = Date.now();
    for (const inv of paid) {
      const at = asDate(inv.paidAt).getTime();
      expect(at, `${String(inv.id)} betald före utställning`).toBeGreaterThanOrEqual(asDate(inv.issuedAt).getTime());
      expect(at, `${String(inv.id)} betald i framtiden`).toBeLessThanOrEqual(now);
    }
  });

  it("paidAt sammanfaller med en faktisk betalning på fakturan", () => {
    for (const inv of paid) {
      const dates = seed.payments
        .filter((p) => p.invoiceId === inv.id)
        .map((p) => asDate(p.paidAt).getTime());
      expect(dates, `${String(inv.id)} saknar betalning på sitt paidAt`).toContain(asDate(inv.paidAt).getTime());
    }
  });
});

describe("kostnadsräkningarnas livscykel finns i datan (#828)", () => {
  it("de offentliga uppdragen har faktureringskörningar", () => {
    // Var noll före #1021 — KR-panelen var tom i hela sandlådan, trots att
    // 2026-0019:s beskrivning lovar en överklagad prutning.
    expect(seed.billingRuns.length).toBeGreaterThanOrEqual(4);
    for (const run of seed.billingRuns) {
      expect(run.type).toBe("KOSTNADSRAKNING");
      expect(run.recipient).toBe("DOMSTOL");
    }
  });

  it("flera KR-lägen vilar samtidigt", () => {
    const states = new Set(seed.billingRuns.map((r) => String(r.kostnadsrakningStatus)));
    expect(states.has("INSKICKAD")).toBe(true);
    expect(states.has("OVERKLAGAD")).toBe(true);
  });

  it("2026-0019 bär den överklagade 25-procentiga nedsättningen", () => {
    const run = seed.billingRuns.find((r) => r.matterId === "m-019-brottmal-overklagad");
    expect(run, "ärendets beskrivning lovar en överklagad prutning").toBeDefined();
    expect(run?.kostnadsrakningStatus).toBe("OVERKLAGAD");
    // Prutningen är negativ per schemat, och dömt = yrkat − prutning.
    expect(Number(run?.prutningOre)).toBe(-Math.round(Number(run?.workValueOreAtRun) * 0.25));
    expect(Number(run?.awardedOre)).toBe(Number(run?.workValueOreAtRun) + Number(run?.prutningOre));
    // Hovrätten har inte sagt sitt — annars vore överklagandet avgjort.
    expect(run?.beslutSlutgiltigt).toBe(false);
  });

  it("en inskickad KR har varken beslut eller prutning", () => {
    for (const run of seed.billingRuns.filter((r) => r.kostnadsrakningStatus === "INSKICKAD")) {
      expect(run.awardedOre, `${String(run.id)}`).toBeNull();
      expect(run.prutningOre, `${String(run.id)}`).toBeNull();
    }
  });
});

describe("utskickshistoriken skiljer skickad från oskickad", () => {
  const issued = seed.invoices.filter((i) => ["SENT", "PAID", "INSTALLMENT_PLAN"].includes(String(i.status)));

  it("varje utställd faktura har ett utskick", () => {
    // Poängen: en tom dispatch-lista ska betyda "aldrig skickad", inte
    // "seeden saknar utskick". Före #1021 var den tom även för BETALDA.
    const dispatched = new Set(seed.invoiceDispatches.map((d) => String(d.invoiceId)));
    const missing = issued.filter((i) => !dispatched.has(String(i.id))).map((i) => String(i.id));
    expect(missing).toEqual([]);
  });

  it("utkast skickas aldrig", () => {
    const drafts = new Set(seed.invoices.filter((i) => i.status === "DRAFT").map((i) => String(i.id)));
    const wrong = seed.invoiceDispatches.filter((d) => drafts.has(String(d.invoiceId)));
    expect(wrong.map((d) => String(d.id))).toEqual([]);
  });

  it("utskicket ligger efter fakturans utställning", () => {
    for (const d of seed.invoiceDispatches) {
      const inv = invoiceById.get(String(d.invoiceId));
      if (!inv) continue;
      expect(asDate(d.queuedAt).getTime(), `${String(d.id)}`).toBeGreaterThanOrEqual(asDate(inv.issuedAt).getTime());
    }
  });
});
