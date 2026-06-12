import { describe, it, expect } from "vitest-compat";
import {
  reconcilePulledPayments,
  makeLedgerPaymentsJob,
  type PaymentsJobCaller,
  type PayableInvoice,
} from "@/lib/server/integrations/ledger/payments-job";
import type { LedgerConnector, LedgerPayment } from "@/lib/server/integrations/ledger/port";

function makeCaller(invoices: PayableInvoice[]) {
  const recorded: Array<{ invoiceId: string; amount: number; paidAt: string; reference?: string }> = [];
  const caller: PaymentsJobCaller = {
    invoice: {
      list: async () => invoices,
      recordPayment: async (input) => {
        recorded.push(input);
        return {};
      },
    },
  };
  return { caller, recorded };
}

const pullConnector = (payments: LedgerPayment[]): LedgerConnector => ({
  name: "bankfil-camt",
  capabilities: () => ({ pushVoucher: false, pushInvoice: false, pullPayments: true, exportSie: false }),
  pullPayments: async () => payments,
});

const INV: PayableInvoice = { id: "inv-1", ocrReference: "2026004206", payments: [] };

describe("reconcilePulledPayments", () => {
  it("bokför matchade betalningar via recordPayment", async () => {
    const { caller, recorded } = makeCaller([INV]);
    const connector = pullConnector([
      { externalId: "tx-1", amount: 12_500, ocrReference: "2026004206", date: "2026-06-01", payerName: "Klient" },
    ]);
    const res = await reconcilePulledPayments(caller, { loadConnector: async () => connector });

    expect(res).toEqual({ recorded: 1, unmatched: 0 });
    expect(recorded).toEqual([
      { invoiceId: "inv-1", amount: 12_500, paidAt: "2026-06-01", note: "Bankfil-avprickning — Klient", reference: "tx-1" },
    ]);
  });

  it("hoppar över redan bokförda referenser (idempotent)", async () => {
    const { caller, recorded } = makeCaller([{ ...INV, payments: [{ reference: "tx-1" }] }]);
    const connector = pullConnector([{ externalId: "tx-1", amount: 12_500, ocrReference: "2026004206" }]);
    const res = await reconcilePulledPayments(caller, { loadConnector: async () => connector });
    expect(res).toEqual({ recorded: 0, unmatched: 1 });
    expect(recorded).toHaveLength(0);
  });

  it("paidAt faller tillbaka på klockan när betalningen saknar datum", async () => {
    const { caller, recorded } = makeCaller([INV]);
    const connector = pullConnector([{ externalId: "tx-9", amount: 5_000, ocrReference: "2026004206" }]);
    await reconcilePulledPayments(caller, {
      loadConnector: async () => connector,
      clock: () => new Date("2026-06-12T10:00:00Z"),
    });
    expect(recorded[0]?.paidAt).toBe("2026-06-12");
  });

  it("ingen connector → ingen avprickning", async () => {
    const { caller, recorded } = makeCaller([INV]);
    const res = await reconcilePulledPayments(caller, { loadConnector: async () => null });
    expect(res).toEqual({ recorded: 0, unmatched: 0 });
    expect(recorded).toHaveLength(0);
  });

  it("connector utan pullPayments-capability → hoppar över", async () => {
    const { caller } = makeCaller([INV]);
    const noPull: LedgerConnector = {
      name: "x",
      capabilities: () => ({ pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false }),
    };
    const res = await reconcilePulledPayments(caller, { loadConnector: async () => noPull });
    expect(res).toEqual({ recorded: 0, unmatched: 0 });
  });
});

describe("makeLedgerPaymentsJob", () => {
  it("returnerar ett PeerJob vars act prickar av via callern", async () => {
    const { caller, recorded } = makeCaller([INV]);
    const connector = pullConnector([{ externalId: "tx-1", amount: 12_500, ocrReference: "2026004206" }]);
    const job = makeLedgerPaymentsJob({ loadConnector: async () => connector });
    expect(job.message).toMatch(/payments/i);
    await job.act(caller as unknown as Parameters<typeof job.act>[0]);
    expect(recorded).toHaveLength(1);
  });
});
