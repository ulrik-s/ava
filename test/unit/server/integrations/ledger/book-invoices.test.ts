/**
 * Bokförings-drivrutinen (#1030).
 *
 * Connectorn och verifikat-byggaren är testade var för sig sedan #82/#235.
 * Det här testar LIMMET, och särskilt de egenskaper som inte går att ångra i
 * en huvudbok: att en redan bokförd faktura aldrig bokförs igen, och att ett
 * fel på en faktura inte tar med sig de andra.
 */

import { describe, it, expect } from "vitest-compat";
import {
  bookUnbookedInvoices,
  isBookable,
  type BookableInvoice,
} from "@/lib/server/integrations/ledger/book-invoices";
import type { LedgerCapabilities, SemanticVoucher } from "@/lib/server/integrations/ledger/port";

const CAPS: LedgerCapabilities = { pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false };

function invoice(over: Partial<BookableInvoice> = {}): BookableInvoice {
  return {
    id: "inv-1", amount: 125_000, vatOre: 25_000, vatBreakdown: null,
    invoiceDate: "2026-05-02", invoiceNumber: "F-2026-0001", status: "SENT",
    fortnoxId: null, matter: { matterNumber: "2026-0001" },
    ...over,
  };
}

/** Connector som räknar pushar och kan fås att faila. */
function fakeConnector(opts: { failOn?: string } = {}) {
  const pushed: Array<{ voucher: SemanticVoucher; key: string }> = [];
  let seq = 0;
  return {
    pushed,
    capabilities: () => CAPS,
    pushVoucher: async (voucher: SemanticVoucher, ctx: { idempotencyKey: string }) => {
      if (opts.failOn === ctx.idempotencyKey) throw new Error("Fortnox: 400 Felaktig datastruktur");
      pushed.push({ voucher, key: ctx.idempotencyKey });
      return { externalId: `A/${++seq}` };
    },
  };
}

describe("isBookable", () => {
  it("en utställd faktura utan externt id är kandidat", () => {
    expect(isBookable(invoice())).toBe(true);
  });

  it("redan bokförd faktura är ALDRIG kandidat", () => {
    expect(isBookable(invoice({ fortnoxId: "A/17" }))).toBe(false);
  });

  it("utkast bokförs inte — det är inte utställt", () => {
    expect(isBookable(invoice({ status: "DRAFT" }))).toBe(false);
  });

  it("annullerad bokförs inte — krediteringen är en egen faktura", () => {
    expect(isBookable(invoice({ status: "CANCELLED" }))).toBe(false);
  });

  it("kundförlust bokförs — den är en verklig affärshändelse (ADR 0007)", () => {
    expect(isBookable(invoice({ status: "BAD_DEBT" }))).toBe(true);
  });
});

describe("bookUnbookedInvoices", () => {
  it("bokför kandidaten, skriver tillbaka externt id", async () => {
    const c = fakeConnector();
    const marked: Array<[string, string]> = [];
    const res = await bookUnbookedInvoices({
      invoices: [invoice()], connector: c,
      markBooked: async (id, ext) => { marked.push([id, ext]); },
    });
    expect(res).toEqual([{ invoiceId: "inv-1", invoiceNumber: "F-2026-0001", externalId: "A/1", error: null }]);
    expect(marked).toEqual([["inv-1", "A/1"]]);
  });

  it("IDEMPOTENT: en omkörning rör inte redan bokförda fakturor", async () => {
    // Det här är hela poängen — en dubbelbokföring går inte att ångra.
    const c = fakeConnector();
    const first = await bookUnbookedInvoices({
      invoices: [invoice()], connector: c, markBooked: async () => {},
    });
    // Andra körningen ser fakturan som den nu ÄR: med externt id.
    const second = await bookUnbookedInvoices({
      invoices: [invoice({ fortnoxId: first[0]!.externalId })], connector: c, markBooked: async () => {},
    });
    expect(second).toEqual([]);
    expect(c.pushed).toHaveLength(1);
  });

  it("ett fel på en faktura stoppar inte de övriga", async () => {
    const c = fakeConnector({ failOn: "inv-2" });
    const res = await bookUnbookedInvoices({
      invoices: [invoice({ id: "inv-1" }), invoice({ id: "inv-2" }), invoice({ id: "inv-3" })],
      connector: c, markBooked: async () => {},
    });
    expect(res.map((r) => r.invoiceId)).toEqual(["inv-1", "inv-2", "inv-3"]);
    expect(res[1]?.error).toMatch(/Felaktig datastruktur/);
    expect(res[1]?.externalId).toBeNull();
    expect(res.filter((r) => r.externalId !== null)).toHaveLength(2);
  });

  it("markerar INTE som bokförd när pushen fallerar", async () => {
    // Annars vore fakturan omöjlig att boka om — märkt men obokförd.
    const c = fakeConnector({ failOn: "inv-1" });
    const marked: string[] = [];
    await bookUnbookedInvoices({
      invoices: [invoice()], connector: c, markBooked: async (id) => { marked.push(id); },
    });
    expect(marked).toEqual([]);
  });

  it("verifikatet bär ärendenumret (#785)", async () => {
    const c = fakeConnector();
    await bookUnbookedInvoices({
      invoices: [invoice()], connector: c, markBooked: async () => {},
    });
    expect(JSON.stringify(c.pushed[0]?.voucher)).toContain("2026-0001");
  });

  it("idempotens-nyckeln är fakturans id", async () => {
    const c = fakeConnector();
    await bookUnbookedInvoices({ invoices: [invoice()], connector: c, markBooked: async () => {} });
    expect(c.pushed[0]?.key).toBe("inv-1");
  });

  it("bilaga skickas med när den finns (#785)", async () => {
    const seen: unknown[] = [];
    const c = {
      capabilities: () => CAPS,
      pushVoucher: async (_v: SemanticVoucher, ctx: { attachment?: unknown }) => {
        seen.push(ctx.attachment); return { externalId: "A/1" };
      },
    };
    await bookUnbookedInvoices({
      invoices: [invoice()], connector: c, markBooked: async () => {},
      attachmentFor: async () => ({ fileName: "F-2026-0001.pdf", bytes: new Uint8Array([1, 2]) }),
    });
    expect((seen[0] as { fileName: string }).fileName).toBe("F-2026-0001.pdf");
  });

  it("en trasig bilaga stoppar INTE bokföringen", async () => {
    // Arkivering är ett separat problem från att bokföra rätt belopp.
    const c = fakeConnector();
    const res = await bookUnbookedInvoices({
      invoices: [invoice()], connector: c, markBooked: async () => {},
      attachmentFor: async () => { throw new Error("PDF saknas"); },
    });
    expect(res[0]?.externalId).toBe("A/1");
    expect(res[0]?.error).toBeNull();
  });

  it("kastar om connectorn saknar pushVoucher-kapabilitet", async () => {
    const noPush = { capabilities: () => ({ ...CAPS, pushVoucher: false }) };
    await expect(bookUnbookedInvoices({
      invoices: [invoice()], connector: noPush, markBooked: async () => {},
    })).rejects.toThrow(/pushVoucher/);
  });
});
