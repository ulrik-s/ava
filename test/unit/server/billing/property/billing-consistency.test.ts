/**
 * Egenskapstester: dokument, lagrat belopp och faktura stämmer per ärende (#1255).
 *
 * Arvode, moms, avrundning och rättshjälpens delning räknas i `src/lib/shared`
 * och körs både i klienten (dokumentet) och på servern (körningen, fakturan).
 * Varje seed slumpar ett ärende per betalningssätt, kör det genom routrarna och
 * kräver att de tre beloppen är samma:
 *
 * - KR-dokumentets yrkande (`kostnadsrakningClaimInclVat`, med samma indata som
 *   dialogen respektive rättshjälpsgeneratorn skickar);
 * - körningens lagrade belopp (`workValueOreAtRun`);
 * - den slutliga fakturan när domstolen beviljar det yrkade.
 *
 * Ett fel återskapas med `AVA_BILLING_SEED=<seed>`.
 */

import { describe, expect, it } from "vitest-compat";
import { kostnadsrakningClaimInclVat, type KrClaimInput } from "@/lib/shared/kostnadsrakning";
import { rng, type Rng } from "../../../helpers/seeded-rng";
import { type BillingWorld, type Scenario, scenarioFor, worldFor } from "./billing-world";

const SEEDS: number[] = process.env.AVA_BILLING_SEED
  ? [Number(process.env.AVA_BILLING_SEED)]
  : Array.from({ length: Number(process.env.AVA_BILLING_SEEDS ?? 40) }, (_, i) => i + 1);

/**
 * Privat slutfaktura räknad för hand ur ärendet: posternas egna á-priser med
 * 25 % moms. Kostnadselement vidarefaktureras med sin ingående moms avräknad
 * och 25 % pålagt; äkta utlägg går vidare som de är, utan moms.
 */
function privateGrossOre(s: Scenario): number {
  const vat25 = (net: number): number => Math.round(net * 0.25);
  const ownNet = (x: Scenario["expenses"][number]): number =>
    x.vatIncluded && x.vatRate > 0 ? Math.round((x.amount * 10_000) / (10_000 + x.vatRate)) : x.amount;
  const arvodeNet = s.entries.reduce((sum, e) => sum + Math.round((e.minutes / 60) * e.hourlyRate), 0);
  const chargedNet = s.expenses.filter((x) => !x.passThrough).reduce((sum, x) => sum + ownNet(x), 0);
  const passThrough = s.expenses.filter((x) => x.passThrough).reduce((sum, x) => sum + x.amount, 0);
  return arvodeNet + vat25(arvodeNet) + chargedNet + vat25(chargedNet) + passThrough;
}

/** Dokumentets yrkande med samma indata som klienten bygger det av. */
async function documentClaim(world: BillingWorld, s: Scenario, now: Date): Promise<number> {
  const { entries } = await world.caller.timeEntry.list({ matterId: world.matterId, pageSize: 100 });
  const input: KrClaimInput = s.method === "RATTSHJALP"
    ? { hufStart: now, hufEnd: now, yrkandeDate: now, isTaxeArende: false, expenses: s.expenses, timeEntries: entries }
    : {
      hufStart: new Date(s.huf.hufStart), hufEnd: new Date(s.huf.hufEnd), yrkandeDate: now,
      taxaLevel: s.taxaLevel, hasFTax: true, isTaxeArende: s.isTaxe, expenses: s.expenses, timeEntries: entries,
    };
  return kostnadsrakningClaimInclVat(input);
}

async function submitKr(world: BillingWorld, s: Scenario): Promise<{ claimed: number; documented: number; runId: string }> {
  const now = new Date();
  const documented = await documentClaim(world, s, now);
  const dialog = s.method === "RATTSHJALP" ? {} : { ...s.huf, taxaLevel: s.taxaLevel, isTaxeArende: s.isTaxe, hasFTax: true };
  const { run } = await world.caller.billingRun.createKostnadsrakning({ matterId: world.matterId, ...dialog });
  return { claimed: run.workValueOreAtRun ?? -1, documented, runId: run.id };
}

describe.each(SEEDS)("seed %i", (seed) => {
  const r: Rng = rng(seed);

  it("offentligt uppdrag: dokument = körning = faktura vid fullt beviljat", async () => {
    const s = scenarioFor(r, "OFFENTLIGT_UPPDRAG");
    const world = worldFor(s);
    const { claimed, documented, runId } = await submitKr(world, s);
    expect({ seed, claimed }).toEqual({ seed, claimed: documented });
    await world.caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: runId, awardedOre: claimed });
    const { invoice } = await world.caller.billingRun.setVerdict({ billingRunId: runId });
    expect({ seed, invoiced: invoice.amount }).toEqual({ seed, invoiced: claimed });
  });

  it("rättshjälp: dokument = körning = fakturerat vid fullt beviljat, ingen förlust", async () => {
    const s = scenarioFor(r, "RATTSHJALP");
    const world = worldFor(s);
    const { claimed, documented, runId } = await submitKr(world, s);
    expect({ seed, claimed }).toEqual({ seed, claimed: documented });
    await world.caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: runId, awardedOre: claimed });
    const { clientInvoice, payerInvoice, split } = await world.caller.billingRun.settleCoverage({ matterId: world.matterId, payerRecipient: "DOMSTOL" });
    expect({ seed, invoiced: clientInvoice.amount + payerInvoice.amount, loss: split.firmLossOre })
      .toEqual({ seed, invoiced: claimed, loss: 0 });
  });

  it("privat: slutfakturans belopp = summan av dess momsrader = upparbetat", async () => {
    const s = scenarioFor(r, "PRIVAT");
    const world = worldFor(s);
    const { invoice } = await world.caller.billingRun.createFinal({ matterId: world.matterId, recipient: "KLIENT" });
    const lines = invoice.vatBreakdown ?? [];
    const linesGross = lines.reduce((sum, l) => sum + l.netOre + l.vatOre, 0);
    const expected = privateGrossOre(s);
    expect({ seed, invoiced: invoice.amount, lines: linesGross }).toEqual({ seed, invoiced: expected, lines: expected });
  });
});
