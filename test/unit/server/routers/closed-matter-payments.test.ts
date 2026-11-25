/**
 * Integrationstest (#2102): betalningar läggs in och matchas också i ett
 * avslutat ärende (status CLOSED). Varken betalfilsmatchningen, fakturans
 * betalningar eller de förväntade fordringarna tittar på ärendets status —
 * testet låser det, så att en framtida statusspärr inte kan ta bort det tyst.
 *
 * Kör `appRouter` mot riktig DemoDataStore via buildContext, som
 * expectedReceivable.test.ts. Varje flöde är ett eget `it`.
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { buildOcrReference } from "@/lib/shared/ocr-reference";
import type { CamtTransaction } from "@/lib/shared/payments/camt-parse";
import { matchTransactions } from "@/lib/shared/payments/match-payments";
import { matchReceivables } from "@/lib/shared/payments/match-receivables";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1") };
const OCR = buildOcrReference("20260001");
const MATTER = { id: "m-closed", organizationId: "org-1", matterNumber: "2026-0001", title: "Avslutat mål", status: "CLOSED", courtCaseNumber: "B 1234-26", createdAt: new Date() };

function makeCaller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }],
    matters: [MATTER],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    invoices: [{
      id: "inv-1", matterId: "m-closed", invoiceNumber: "F-2026-0001", ocrReference: OCR,
      amount: 100_000, status: "SENT", invoiceType: "STANDARD", invoiceDate: new Date("2026-09-01"),
      matter: { id: "m-closed", organizationId: "org-1" },
    }],
    payments: [],
    paymentPlans: [],
  }, async () => {});
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

function camtTx(over: Partial<CamtTransaction>): CamtTransaction {
  return {
    reference: "TX-1", amountOre: 100_000, currency: "SEK", valueDate: "2026-10-01",
    debtorName: "Betalare", creditDebit: "CRDT", structuredRefs: [], freeTexts: [], ...over,
  };
}

describe("avslutat ärende: fakturans betalningar (#2102)", () => {
  it("invoice.list innehåller fakturan i det stängda ärendet", async () => {
    const caller = makeCaller();
    const list = await caller.invoice.list({});
    expect(list.items.map((i) => String(i.id))).toContain("inv-1");
  });

  it("matchTransactions bokar en camt-transaktion med fakturans OCR mot fakturan", async () => {
    const caller = makeCaller();
    const items = (await caller.invoice.list({})).items;
    const candidates = items.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber ?? null, ocrReference: i.ocrReference ?? null,
      amount: i.amount, paymentReferences: [],
    }));
    const out = matchTransactions([camtTx({ structuredRefs: [{ ref: OCR, amountOre: null }] })], candidates);
    expect(out.unmatched).toHaveLength(0);
    expect(out.bookable).toHaveLength(1);
    expect(String(out.bookable[0]?.invoiceId)).toBe("inv-1");
    expect(out.bookable[0]?.matchedBy).toBe("ocr");
  });

  it("invoice.recordPayment ger en betalning och status PAID", async () => {
    const caller = makeCaller();
    await caller.invoice.recordPayment({ invoiceId: "inv-1", amount: 100_000, paidAt: "2026-10-01", reference: "TX-1" });
    const inv = await caller.invoice.getById({ id: "inv-1" });
    expect(inv.status).toBe("PAID");
    expect(inv.payments).toHaveLength(1);
  });
});

describe("avslutat ärende: förväntade fordringar (#2102)", () => {
  it("expectedReceivable.create går att köra på det stängda ärendet", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-closed", description: "Kostnadsräkning", expectedAmount: 50_000 });
    expect(r.status).toBe("PENDING");
  });

  it("expectedReceivable.candidates innehåller fordran", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-closed", description: "Kostnadsräkning", expectedAmount: 50_000 });
    const cands = await caller.expectedReceivable.candidates();
    expect(cands.map((c) => c.id)).toContain(String(r.id));
  });

  it("matchReceivables föreslår fordran ur målnumret", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-closed", description: "Kostnadsräkning", expectedAmount: 50_000 });
    const cands = (await caller.expectedReceivable.candidates()).map((c) => ({
      ...c, id: asId<"ExpectedReceivableId">(c.id), settledReferences: [],
    }));
    const out = matchReceivables([camtTx({ amountOre: 50_000, freeTexts: ["Kostnadsräkning B 1234-26 ADVOKAT"] })], cands);
    expect(out.suggestions.map((s) => String(s.receivableId))).toEqual([String(r.id)]);
  });

  it("expectedReceivable.settle ger SETTLED", async () => {
    const caller = makeCaller();
    const r = await caller.expectedReceivable.create({ matterId: "m-closed", description: "Kostnadsräkning", expectedAmount: 50_000 });
    const settled = await caller.expectedReceivable.settle({ id: String(r.id), settledAmount: 50_000, paymentReference: "TX-2" });
    expect(settled.status).toBe("SETTLED");
  });
});
