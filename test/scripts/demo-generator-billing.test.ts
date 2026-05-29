/**
 * Fakturerings-flödena (ADR-beslut "1a"): generatorn driver de RIKTIGA
 * mutationerna (createAcconto/createFinal/recordPayment/createPaymentPlan/
 * createCredit) → organiska fakturor med beräknade belopp.
 *
 * Kör mot hela buildSeed() (14 fakturerbara ärenden) så hela scenariot
 * (acconto, betalda, aktiva/slutförda/avbrutna planer, kredit) täcks.
 */

import { describe, it, expect } from "vitest";
import { buildSeed } from "../../tooling/scripts/seed-data";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateBilling } from "../../tooling/demo-generator/populate-billing";

const ADMIN = { id: "gen", email: "gen@ava.local", name: "Generator", role: "ADMIN", organizationId: "firma-ab" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Inv = any;

describe("populateBilling — driver fakturerings-flödena", () => {
  it("genererar organiska fakturor + planer + kredit i olika faser", async () => {
    const seed = buildSeed(); // orgId default "firma-ab"
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    const billing = await populateBilling(target.caller, seed);

    expect(billing.invoices).toBeGreaterThan(10);
    expect(billing.paymentPlans).toBeGreaterThanOrEqual(7);
    expect(billing.payments).toBeGreaterThan(5);
    expect(billing.credits).toBe(1);
    expect(billing.reminders).toBeGreaterThan(0); // påminnelse-historik på planerna

    const invoices: Inv[] = await (target.caller as Inv).invoice.list({});
    const byStatus = (s: string) => invoices.filter((i: Inv) => i.status === s).length;
    expect(byStatus("PAID")).toBeGreaterThan(0); // betalda finals + slutförd plan
    expect(byStatus("INSTALLMENT_PLAN")).toBeGreaterThan(0); // aktiva planer
    expect(byStatus("DRAFT")).toBeGreaterThan(0); // kvarvarande drafts
    expect(byStatus("CANCELLED")).toBe(1); // krediterad originalfaktura
    expect(invoices.some((i: Inv) => i.invoiceType === "ACCONTO")).toBe(true);
    expect(invoices.some((i: Inv) => i.invoiceType === "CREDIT")).toBe(true);
  });

  it("paymentPlan.list ser planerna (samma query som /payment-plans-sidan)", async () => {
    const seed = buildSeed();
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);
    // Exakt queryn som listsidan kör — nested where-filter invoice.matter.organizationId.
    const plans = await (target.caller as Inv).paymentPlan.list({});
    expect(plans.length).toBe(7); // 5 aktiva + 1 slutförd + 1 avbruten
    expect(plans.every((p: Inv) => p.invoice?.matter?.matterNumber)).toBe(true); // join hydrerad
  });

  it("flaggar fakturerade tidsposter (invoiceId sätts via flödet)", async () => {
    const seed = buildSeed();
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);

    const list = await (target.caller as Inv).timeEntry.list({ pageSize: 100 });
    const billed = list.entries.filter((e: Inv) => e.invoiceId != null);
    expect(billed.length).toBeGreaterThan(0); // createFinal kopplade poster till fakturor
  });
});
