import { describe, it, expect, vi } from "vitest-compat";
import { bookUnbookedPayments } from "@/lib/server/integrations/ledger/book-payments";

const caps = (push: boolean) => ({ pushVoucher: push, pushInvoice: false, pullPayments: false, exportSie: false });
const invoice = { invoiceNumber: "F-1", matterNumber: "M-1" };

describe("bookUnbookedPayments", () => {
  it("bokför obokförda, äldst först, och markerar dem", async () => {
    const descriptions: string[] = [];
    let n = 0;
    const connector = {
      capabilities: () => caps(true),
      pushVoucher: vi.fn(async (v: { description: string; date: Date | string }) => { descriptions.push(String(v.date)); return { externalId: `A/${++n}` }; }),
    };
    const markBooked = vi.fn(async () => undefined);
    const payments = [
      { id: "b", amount: 200, paidAt: "2026-09-20" },
      { id: "x", amount: 50, paidAt: "2026-09-01", fortnoxId: "A/0" },
      { id: "a", amount: 100, paidAt: "2026-09-10" },
    ];
    const out = await bookUnbookedPayments({ payments, invoice, connector, markBooked });
    expect(out).toEqual([
      { paymentId: "a", externalId: "A/1", error: null },
      { paymentId: "b", externalId: "A/2", error: null },
    ]);
    expect(descriptions).toEqual(["2026-09-10", "2026-09-20"]);
    expect(markBooked).toHaveBeenCalledWith(payments[2], "A/1");
  });

  it("fel per betalning i st.f. att kasta; övriga fortsätter", async () => {
    let first = true;
    const connector = {
      capabilities: () => caps(true),
      pushVoucher: async () => { if (first) { first = false; throw new Error("nej"); } return { externalId: "A/5" }; },
    };
    const out = await bookUnbookedPayments({
      payments: [{ id: "a", amount: 1, paidAt: "2026-09-01" }, { id: "b", amount: 1, paidAt: "2026-09-02" }],
      invoice, connector, markBooked: async () => undefined,
    });
    expect(out).toEqual([
      { paymentId: "a", externalId: null, error: "nej" },
      { paymentId: "b", externalId: "A/5", error: null },
    ]);
  });

  it("connector utan pushVoucher → fel per betalning", async () => {
    const out = await bookUnbookedPayments({
      payments: [{ id: "a", amount: 1, paidAt: "2026-09-01" }],
      invoice, connector: { capabilities: () => caps(false) }, markBooked: async () => undefined,
    });
    expect(out[0]?.error).toMatch(/pushVoucher/);
  });

  it("icke-Error-kast blir text", async () => {
    const out = await bookUnbookedPayments({
      payments: [{ id: "a", amount: 1, paidAt: "2026-09-01" }],
      invoice, markBooked: async () => undefined,
      connector: { capabilities: () => caps(true), pushVoucher: async () => { throw "sträng"; } },
    });
    expect(out[0]?.error).toBe("sträng");
  });
});
