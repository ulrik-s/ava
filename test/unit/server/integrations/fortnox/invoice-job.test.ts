import { describe, it, expect } from "vitest-compat";
import {
  bookUnsyncedInvoices,
  makeFortnoxInvoiceJob,
  type BookableInvoice,
  type FortnoxJobCaller,
} from "@/lib/server/integrations/fortnox/invoice-job";
import { FortnoxLedgerConnector } from "@/lib/server/integrations/fortnox/connector";
import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import type { FortnoxKontoMappning, FortnoxVoucher, FortnoxVoucherResponse } from "@/lib/server/integrations/fortnox/schema";
import type { LedgerConnector } from "@/lib/server/integrations/ledger/port";

const MAPPING: FortnoxKontoMappning = {
  voucherSeries: "A",
  kundfordran: "1510",
  intaktArvode: "3000",
  momsUtgaende: "2611",
};

function inv(over: Partial<BookableInvoice> = {}): BookableInvoice {
  return {
    id: "inv-1",
    status: "SENT",
    amount: 1_250_000, // 12 500 kr brutto (öre)
    invoiceDate: "2026-06-11",
    invoiceNumber: "F-1",
    fortnoxId: null,
    ...over,
  };
}

function makeCaller(invoices: BookableInvoice[]) {
  const booked: { invoiceId: string; fortnoxId: string }[] = [];
  const caller: FortnoxJobCaller = {
    invoice: {
      list: async () => invoices,
      markFortnoxBooked: async (input) => {
        booked.push(input);
        return {};
      },
    },
    // Konto-mappningen deriveras härifrån i prod; dessa tester injicerar dock
    // connectorn direkt via loadConnector, så getSettings träffas inte.
    organization: { getSettings: async () => ({ ledgerAccountMap: null }) },
  };
  return { caller, booked };
}

function makeClient(failMatch?: (v: FortnoxVoucher) => boolean) {
  const calls: FortnoxVoucher[] = [];
  let n = 0;
  const client: Pick<FortnoxClient, "createVoucher"> = {
    createVoucher: async (v: FortnoxVoucher): Promise<FortnoxVoucherResponse> => {
      calls.push(v);
      if (failMatch?.(v)) throw new Error("boom");
      n += 1;
      return { Voucher: { VoucherSeries: v.VoucherSeries, VoucherNumber: n } };
    },
  };
  return { client, calls };
}

/** Bygg en `loadConnector` som lindar Fortnox-connectorn runt fake-klienten. */
const withConnector =
  (client: Pick<FortnoxClient, "createVoucher">, m: FortnoxKontoMappning | null) =>
  async (): Promise<LedgerConnector | null> =>
    m ? new FortnoxLedgerConnector({ client, mapping: m }) : null;

describe("bookUnsyncedInvoices", () => {
  it("bokför obokförda utfärdade fakturor + skriver tillbaka fortnoxId", async () => {
    const { caller, booked } = makeCaller([inv({ id: "a" }), inv({ id: "b" })]);
    const { client, calls } = makeClient();

    const res = await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, MAPPING) });

    expect(res).toEqual({ booked: 2, failed: 0, skipped: 0 });
    expect(calls).toHaveLength(2);
    expect(booked).toEqual([
      { invoiceId: "a", fortnoxId: "A/1" },
      { invoiceId: "b", fortnoxId: "A/2" },
    ]);
  });

  it("hoppar över redan bokförda (fortnoxId satt)", async () => {
    const { caller, booked } = makeCaller([inv({ id: "a", fortnoxId: "A/9" }), inv({ id: "b" })]);
    const { client } = makeClient();

    const res = await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, MAPPING) });

    expect(res).toEqual({ booked: 1, failed: 0, skipped: 1 });
    expect(booked).toEqual([{ invoiceId: "b", fortnoxId: "A/1" }]);
  });

  it("hoppar över ej bokningsbara statusar (DRAFT/CANCELLED)", async () => {
    const { caller, booked } = makeCaller([
      inv({ id: "a", status: "DRAFT" }),
      inv({ id: "b", status: "CANCELLED" }),
      inv({ id: "c", status: "PAID" }),
    ]);
    const { client } = makeClient();

    const res = await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, MAPPING) });

    expect(res).toEqual({ booked: 1, failed: 0, skipped: 2 });
    expect(booked).toEqual([{ invoiceId: "c", fortnoxId: "A/1" }]);
  });

  it("ingen konto-mappning → bokför inget (completeness-gate)", async () => {
    const { caller, booked } = makeCaller([inv()]);
    const { client, calls } = makeClient();

    const res = await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, null) });

    expect(res).toEqual({ booked: 0, failed: 0, skipped: 0 });
    expect(calls).toHaveLength(0);
    expect(booked).toHaveLength(0);
  });

  it("connector utan pushVoucher-capability → bokför inget", async () => {
    const { caller, booked } = makeCaller([inv()]);
    const noPush: LedgerConnector = {
      name: "saknar-push",
      capabilities: () => ({ pushVoucher: false, pushInvoice: false, pullPayments: false, exportSie: false }),
    };
    const res = await bookUnsyncedInvoices(caller, { loadConnector: async () => noPush });
    expect(res).toEqual({ booked: 0, failed: 0, skipped: 0 });
    expect(booked).toHaveLength(0);
  });

  it("ett fel stoppar inte resten (räknas som failed, ingen markering)", async () => {
    const { caller, booked } = makeCaller([inv({ id: "a", invoiceNumber: "F-A" }), inv({ id: "b", invoiceNumber: "F-B" })]);
    const { client } = makeClient((v) => v.Description.includes("F-A"));

    const res = await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, MAPPING) });

    expect(res).toEqual({ booked: 1, failed: 1, skipped: 0 });
    expect(booked).toEqual([{ invoiceId: "b", fortnoxId: "A/1" }]); // bara den lyckade
  });

  it("bygger ett balanserat verifikat (debet kundfordran = brutto)", async () => {
    const { caller } = makeCaller([inv()]);
    const { client, calls } = makeClient();

    await bookUnsyncedInvoices(caller, { loadConnector: withConnector(client, MAPPING) });

    const rows = calls[0]!.VoucherRows;
    const debit = rows.reduce((s, r) => s + r.Debit, 0);
    const credit = rows.reduce((s, r) => s + r.Credit, 0);
    expect(debit).toBeCloseTo(credit); // balans
    const kundfordran = rows.find((r) => r.Account === 1510)!;
    expect(kundfordran.Debit).toBeCloseTo(12_500); // brutto i SEK
  });
});

describe("makeFortnoxInvoiceJob", () => {
  it("returnerar ett PeerJob vars act bokför via callern", async () => {
    const { caller, booked } = makeCaller([inv({ id: "a" })]);
    const { client } = makeClient();
    const job = makeFortnoxInvoiceJob({ loadConnector: withConnector(client, MAPPING) });

    expect(job.message).toMatch(/fortnox/i);
    // act tar hela tRPC-callern; vi skickar vår delmängd (samma cast som i wrappern).
    await job.act(caller as unknown as Parameters<typeof job.act>[0]);

    expect(booked).toEqual([{ invoiceId: "a", fortnoxId: "A/1" }]);
  });
});
