import { describe, it, expect, vi } from "vitest-compat";
import { Mutex } from "@/lib/server/concurrency/mutex";
import type { ILedgerService } from "@/lib/server/ports";
import { ledgerRouter } from "@/lib/server/routers/ledger";
import { DEFAULT_LEDGER_ACCOUNT_MAP } from "@/lib/shared/accounting/account-map";

const INV_ID = "0190a3f0-0000-7000-8000-000000000001";

interface Opts {
  role?: string;
  invoice?: Record<string, unknown> | null;
  ledgerAccountMap?: unknown;
  ledger?: Partial<ILedgerService>;
}

/**
 * En transaktion med fakturans bokföringslås som i Postgres (#1453): låset tas
 * av `lockForBooking` och hålls till transaktionens slut.
 */
function lockingTransaction<R extends { invoices: object }>(repos: R, locks: { taken: number }) {
  const lock = new Mutex();
  return async <T,>(fn: (tx: R) => Promise<T>): Promise<T> => {
    let release = (): void => {};
    const lockForBooking = async (): Promise<void> => {
      locks.taken++;
      await new Promise<void>((acquired) => {
        void lock.runExclusive(() => new Promise<void>((done) => { release = done; acquired(); }));
      });
    };
    try {
      return await fn({ ...repos, invoices: { ...repos.invoices, lockForBooking } });
    } finally {
      release();
    }
  };
}

function setup(o: Opts = {}) {
  const invoice = o.invoice === undefined
    ? { id: INV_ID, amount: 12500, vatOre: 2500, vatBreakdown: null, invoiceDate: "2026-09-25", invoiceNumber: "F-1", status: "SENT", fortnoxId: null, matter: { matterNumber: "M-1" }, payments: [] }
    : o.invoice;
  // Write-back syns i nästa läsning, som i databasen.
  const update = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    if (invoice) Object.assign(invoice, patch);
    return patch;
  });
  let n = 6;
  // Ett nätanrop tar tid — utan låset hinner ett andra anrop läsa fakturan obokförd.
  const push = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return { externalId: `A/${++n}` }; });
  const updatePayment = vi.fn(async (_id: string, patch: Record<string, unknown>) => patch);
  const ledger: ILedgerService = {
    status: async () => ({ configured: true, connected: true }),
    authorizeUrl: async () => "https://fortnox.test/auth?state=s",
    completeConnect: vi.fn(async () => undefined),
    connector: () => ({ capabilities: () => ({ pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false }), pushVoucher: push }),
    ...o.ledger,
  };
  const repos = {
    invoices: { getByIdFull: async () => (invoice ? { ...invoice } : null), update },
    payments: { update: updatePayment },
    organizations: { getById: async () => ({ ledgerAccountMap: o.ledgerAccountMap === undefined ? DEFAULT_LEDGER_ACCOUNT_MAP : o.ledgerAccountMap }) },
  };
  const locks = { taken: 0 };
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "A", role: o.role ?? "LAWYER", organizationId: "org-1" },
    repos: { ...repos, transaction: lockingTransaction(repos, locks) },
    ports: { ledger },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal ctx-attrapp
  return { caller: ledgerRouter.createCaller(ctx as any), update, updatePayment, push, ledger, locks };
}

describe("ledger.status / anslutning", () => {
  it("status kommer från porten", async () => {
    expect(await setup().caller.status()).toEqual({ configured: true, connected: true });
  });

  it("connectUrl kräver admin", async () => {
    await expect(setup().caller.connectUrl()).rejects.toThrow(/administratörer/);
    expect(await setup({ role: "ADMIN" }).caller.connectUrl()).toEqual({ url: "https://fortnox.test/auth?state=s" });
  });

  it("connectUrl: portens fel blir läsbart", async () => {
    const { caller } = setup({ role: "ADMIN", ledger: { authorizeUrl: async () => { throw new Error("ej konfigurerad"); } } });
    await expect(caller.connectUrl()).rejects.toThrow("ej konfigurerad");
  });

  it("completeConnect kräver admin och skickar code+state vidare", async () => {
    await expect(setup().caller.completeConnect({ code: "c", state: "s" })).rejects.toThrow(/administratörer/);
    const { caller, ledger } = setup({ role: "ADMIN" });
    expect(await caller.completeConnect({ code: "c", state: "s" })).toEqual({ connected: true });
    expect(ledger.completeConnect).toHaveBeenCalledWith("org-1", "c", "s");
  });

  it("completeConnect: fel från porten", async () => {
    const { caller } = setup({ role: "ADMIN", ledger: { completeConnect: async () => { throw new Error("utgången"); } } });
    await expect(caller.completeConnect({ code: "c", state: "s" })).rejects.toThrow("utgången");
  });
});

describe("ledger.bookInvoice", () => {
  it("bokför utställd faktura och skriver tillbaka verifikatet", async () => {
    const { caller, update, push } = setup();
    expect(await caller.bookInvoice({ invoiceId: INV_ID })).toEqual({ externalId: "A/7", payments: [] });
    expect(push).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(INV_ID, { fortnoxId: "A/7" });
  });

  it("två samtidiga anrop (dubbelklick, två flikar) ger ett verifikat (#1453)", async () => {
    const { caller, push, update, locks } = setup();
    const [a, b] = await Promise.all([caller.bookInvoice({ invoiceId: INV_ID }), caller.bookInvoice({ invoiceId: INV_ID })]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(a.externalId).toBe("A/7");
    expect(b.externalId).toBe("A/7");
    expect(locks.taken).toBe(2);
  });

  it("verifikatet skapat men write-back misslyckas → felet säger vilket och att inte bokföra igen (#1453)", async () => {
    const { caller, update, push } = setup();
    update.mockImplementationOnce(async () => { throw new Error("databasen svarar inte"); });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow(
      /Verifikatet A\/7 skapades.*databasen svarar inte.*Bokför inte igen.*A\/7/,
    );
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("redan bokförd → samma verifikat, ingen ny push", async () => {
    const { caller, push } = setup({ invoice: { id: INV_ID, fortnoxId: "A/3", status: "SENT", payments: [{ id: "p0", fortnoxId: "A/4" }] } });
    expect(await caller.bookInvoice({ invoiceId: INV_ID })).toEqual({ externalId: "A/3", payments: [] });
    expect(push).not.toHaveBeenCalled();
  });

  it("okänd faktura → NOT_FOUND", async () => {
    await expect(setup({ invoice: null }).caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow(/NOT_FOUND/);
  });

  it("saknad kontomappning → be om den", async () => {
    await expect(setup({ ledgerAccountMap: null }).caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow(/kontomappningen/);
  });

  it("utkast bokförs inte", async () => {
    const { caller } = setup({ invoice: { id: INV_ID, amount: 1, status: "DRAFT", fortnoxId: null, invoiceDate: "2026-09-25", matter: null } });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow(/utställda/);
  });

  it("connector saknas → läsbart fel", async () => {
    const { caller } = setup({ ledger: { connector: () => { throw new Error("Ingen bokföringsintegration"); } } });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow("Ingen bokföringsintegration");
  });

  it("push-fel från Fortnox syns", async () => {
    const { caller, update } = setup({
      ledger: { connector: () => ({ capabilities: () => ({ pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false }), pushVoucher: async () => { throw new Error("Fortnox 400"); } }) },
    });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow("Fortnox 400");
    expect(update).not.toHaveBeenCalled();
  });

  const PAYMENTS = [
    { id: "p2", amount: 5000, paidAt: "2026-09-20", fortnoxId: null },
    { id: "p1", amount: 7500, paidAt: "2026-09-10", fortnoxId: null },
  ];

  it("delbetalningar bokförs efter fakturan, äldst först, och skrivs tillbaka", async () => {
    const { caller, updatePayment, push } = setup({
      invoice: { id: INV_ID, amount: 12500, vatOre: 2500, invoiceDate: "2026-09-01", invoiceNumber: "F-1", status: "PAID", fortnoxId: null, matter: { matterNumber: "M-1" }, payments: PAYMENTS },
    });
    expect(await caller.bookInvoice({ invoiceId: INV_ID })).toEqual({ externalId: "A/7", payments: ["A/8", "A/9"] });
    expect(push).toHaveBeenCalledTimes(3);
    expect(updatePayment).toHaveBeenNthCalledWith(1, "p1", { fortnoxId: "A/8" });
    expect(updatePayment).toHaveBeenNthCalledWith(2, "p2", { fortnoxId: "A/9" });
  });

  it("redan bokförd faktura: bara nya betalningar bokförs", async () => {
    const { caller, push } = setup({
      invoice: { id: INV_ID, fortnoxId: "A/3", status: "SENT", invoiceNumber: "F-1", matter: null, payments: [{ id: "p0", amount: 1, paidAt: "2026-09-01", fortnoxId: "A/4" }, PAYMENTS[0]] },
    });
    expect(await caller.bookInvoice({ invoiceId: INV_ID })).toEqual({ externalId: "A/3", payments: ["A/7"] });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("betalningar utan bankkonto i mappningen → be om det", async () => {
    const { bank: _bank, ...noBank } = DEFAULT_LEDGER_ACCOUNT_MAP;
    const { caller } = setup({ ledgerAccountMap: noBank, invoice: { id: INV_ID, fortnoxId: "A/3", status: "SENT", payments: PAYMENTS } });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow(/bankkonto/);
  });

  it("en betalning som fastnar syns som fel", async () => {
    let calls = 0;
    const { caller } = setup({
      invoice: { id: INV_ID, fortnoxId: "A/3", status: "SENT", payments: PAYMENTS },
      ledger: { connector: () => ({ capabilities: () => ({ pushVoucher: true, pushInvoice: false, pullPayments: false, exportSie: false }), pushVoucher: async () => { calls++; if (calls === 2) throw new Error("Fortnox 500"); return { externalId: "A/9" }; } }) },
    });
    await expect(caller.bookInvoice({ invoiceId: INV_ID })).rejects.toThrow("En betalning kunde inte bokföras: Fortnox 500");
  });
});
