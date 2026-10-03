/**
 * Egenskapstester: varje rad på en ny faktura är hela kronor (#1438), och
 * samma tal bärs hela vägen — det lagrade beloppet, momsuppdelningen,
 * specifikationen som dokumentet renderas ur och verifikatet som bokförs.
 *
 * Varje seed slumpar ett ärende per betalningssätt och kör det genom de riktiga
 * routrarna. Ett fel återskapas med `AVA_BILLING_SEED=<seed>`.
 */

import { describe, expect, it } from "vitest-compat";
import { buildSemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { vatOnRow } from "@/lib/shared/whole-kronor";
import { rng, type Rng } from "../../../helpers/seeded-rng";
import { scenarioFor, worldFor } from "./billing-world";

const SEEDS: number[] = process.env.AVA_BILLING_SEED
  ? [Number(process.env.AVA_BILLING_SEED)]
  : Array.from({ length: Number(process.env.AVA_BILLING_SEEDS ?? 40) }, (_, i) => i + 1);

const whole = (ore: number): boolean => ore % 100 === 0;

/** Fakturans alla belopp — och verifikatets rader — i hela kronor, och balanserat. */
function assertWholeAndBalanced(seed: number, invoice: Invoice): void {
  const lines = invoice.vatBreakdown ?? [];
  const amounts = [invoice.amount, invoice.vatOre ?? 0, ...lines.flatMap((l) => [l.netOre, l.vatOre])];
  expect({ seed, nonWhole: amounts.filter((a) => !whole(a)) }).toEqual({ seed, nonWhole: [] });
  expect({ seed, rounding: invoice.amountRounding }).toEqual({ seed, rounding: "KRONOR" });
  // Beloppet är summan av raderna — annars bokför verifikatet något annat än fakturan.
  expect({ seed, lines: lines.reduce((s, l) => s + l.netOre + l.vatOre, 0) }).toEqual({ seed, lines: invoice.amount });
  const voucher = buildSemanticVoucher({ ...invoice, invoiceDate: invoice.invoiceDate ?? new Date() });
  const debit = voucher.rows.reduce((s, r) => s + r.debit, 0);
  const credit = voucher.rows.reduce((s, r) => s + r.credit, 0);
  expect({ seed, debit, wholeRows: voucher.rows.every((r) => whole(r.debit) && whole(r.credit)) })
    .toEqual({ seed, debit: credit, wholeRows: true });
  expect({ seed, kundfordran: voucher.rows.find((r) => r.role === "kundfordran")?.debit }).toEqual({ seed, kundfordran: Math.abs(invoice.amount) });
}

/** Varje 25 %-rad bär 25 % av sitt netto, avrundat till hela kronor. */
function assertVatOnNet(seed: number, invoice: Invoice): void {
  for (const l of invoice.vatBreakdown ?? []) {
    expect({ seed, vat: l.vatOre }).toEqual({ seed, vat: vatOnRow(l.netOre, l.vatRate) });
  }
}

describe.each(SEEDS)("seed %i", (seed) => {
  const r: Rng = rng(seed);

  it("privat slutfaktura: raderna, specifikationen och verifikatet är samma hela kronor", async () => {
    const s = scenarioFor(r, "PRIVAT");
    const world = worldFor(s);
    const { invoice } = await world.caller.billingRun.createFinal({ matterId: world.matterId, recipient: "KLIENT" });
    assertWholeAndBalanced(seed, invoice);
    assertVatOnNet(seed, invoice);
    // Dokumentet renderas ur specifikationen: varje rad hela kronor, raderna
    // summerar till fakturans arvode och utlägg, och ingen justeringsrad behövs.
    const spec = await world.caller.billingRun.invoiceSpecification({ matterId: world.matterId, invoiceId: invoice.id });
    const rows = [...spec.timeLines.map((l) => l.amountOre), ...spec.expenseLines.flatMap((l) => [l.netOre, l.grossOre])];
    expect({ seed, nonWhole: rows.filter((a) => !whole(a)), adjustment: spec.adjustmentOre, payable: spec.payableOre })
      .toEqual({ seed, nonWhole: [], adjustment: 0, payable: invoice.amount });
    const arvode = (invoice.vatBreakdown ?? []).filter((l) => l.kind === "arvode");
    expect({ seed, net: spec.arvodeNetOre, vat: spec.arvodeVatOre })
      .toEqual({ seed, net: arvode.reduce((x, l) => x + l.netOre, 0), vat: arvode.reduce((x, l) => x + l.vatOre, 0) });
  });

  it("aconto + slutfaktura: båda i hela kronor, och acontot bokförs exakt en gång", async () => {
    const s = scenarioFor(r, "PRIVAT");
    const world = worldFor(s);
    // Ett belopp med ören, som någon kan skriva in — fakturan avrundar det.
    const typed = r.int(10_000, 200_000);
    const ac = await world.caller.billingRun.createAcconto({ matterId: world.matterId, clientShareBips: 2000, amountOre: typed });
    expect({ seed, amount: ac.invoice.amount }).toEqual({ seed, amount: Math.floor((typed + 50) / 100) * 100 });
    assertWholeAndBalanced(seed, ac.invoice);
    const before = await world.caller.billingRun.proposal({ matterId: world.matterId });
    const { invoice } = await world.caller.billingRun.createFinal({ matterId: world.matterId, recipient: "KLIENT", deductedBillingRunIds: [ac.run.id] });
    if (invoice.amount <= 0) return; // acontot täckte allt — ingen faktura att bokföra
    assertWholeAndBalanced(seed, invoice);
    // Aconto + slutfaktura = hela arbetet, brutto: inget dubbelbokat och inget tappat.
    const total = ac.invoice.amount + invoice.amount;
    const linesTotal = [...(ac.invoice.vatBreakdown ?? []), ...(invoice.vatBreakdown ?? [])].reduce((x, l) => x + l.netOre + l.vatOre, 0);
    expect({ seed, total }).toEqual({ seed, total: linesTotal });
    expect({ seed, worked: before.workValueOre > 0 }).toEqual({ seed, worked: true });
  });

  it("rättshjälp: klientens och domstolens fakturor är hela kronor och summerar till det beviljade", async () => {
    const s = scenarioFor(r, "RATTSHJALP");
    const world = worldFor(s);
    const { run } = await world.caller.billingRun.createKostnadsrakning({ matterId: world.matterId });
    const claimed = run.workValueOreAtRun ?? -1;
    expect({ seed, whole: whole(claimed) }).toEqual({ seed, whole: true });
    await world.caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: claimed });
    const { clientInvoice, payerInvoice } = await world.caller.billingRun.settleCoverage({ matterId: world.matterId, payerRecipient: "DOMSTOL" });
    for (const inv of [clientInvoice, payerInvoice]) if (inv.amount !== 0) assertWholeAndBalanced(seed, inv);
    expect({ seed, invoiced: clientInvoice.amount + payerInvoice.amount }).toEqual({ seed, invoiced: claimed });
  });

  it("rättshjälp med nedsättning i hela kronor: fakturorna summerar till domen, byrån bär resten", async () => {
    const s = scenarioFor(r, "RATTSHJALP");
    const world = worldFor(s);
    const { run } = await world.caller.billingRun.createKostnadsrakning({ matterId: world.matterId });
    const claimed = run.workValueOreAtRun ?? 0;
    const awarded = Math.floor((claimed * r.int(50, 99)) / 10_000) * 100;
    await world.caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: awarded });
    const { clientInvoice, payerInvoice, split } = await world.caller.billingRun.settleCoverage({ matterId: world.matterId, payerRecipient: "DOMSTOL" });
    for (const inv of [clientInvoice, payerInvoice]) if (inv.amount !== 0) assertWholeAndBalanced(seed, inv);
    expect({ seed, invoiced: clientInvoice.amount + payerInvoice.amount, lossWhole: whole(split.firmLossOre) })
      .toEqual({ seed, invoiced: awarded, lossWhole: true });
  });

  it("rättsskydd med försäkringens prutning: båda fakturorna hela kronor, varje moms 25 % av sitt netto", async () => {
    const s = scenarioFor(r, "RATTSSKYDD");
    const world = worldFor(s);
    const insurerPrutningOre = 100 * r.int(0, 2_000);
    const { clientInvoice, payerInvoice, split } = await world.caller.billingRun.settleCoverage({
      matterId: world.matterId, payerRecipient: "FORSAKRING", insurerPrutningOre,
    });
    for (const inv of [clientInvoice, payerInvoice]) {
      if (inv.amount === 0) continue;
      assertWholeAndBalanced(seed, inv);
      assertVatOnNet(seed, inv);
    }
    // Klientens och försäkringens netto = hela arbetet; inget faller bort i delningen.
    const net = (inv: Invoice): number => (inv.vatBreakdown ?? []).reduce((x, l) => x + l.netOre, 0);
    const parts = split.clientParts;
    expect({ seed, parts: parts ? parts.uncoveredOre + parts.sjalvriskOre + parts.prutningOre + parts.overCapOre : -1 })
      .toEqual({ seed, parts: split.clientOre });
    expect({ seed, arvode: split.clientOre + split.payerOre }).toEqual({ seed, arvode: split.effectiveTotalOre });
    expect({ seed, positive: net(clientInvoice) + net(payerInvoice) >= split.effectiveTotalOre }).toEqual({ seed, positive: true });
  });
});
