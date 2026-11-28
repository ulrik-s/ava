/**
 * `ServerInvoiceNumbering` (#1243) — monterad i self-hosted-trädet kopplar den
 * in resolvern mot klientstoren; utan store (under uppstart) gör den ingenting.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import { type InvoiceNumberingSource, ServerInvoiceNumbering } from "@/components/shell/server-invoice-numbering";
import { InMemoryDeferredFakturaStore, setDeferredFakturaStoreForTests } from "@/lib/client/billing/deferred-faktura-docs";
import { finalInvoiceNumber } from "@/lib/client/billing/invoice-number-finality";
import { fakeTrpcLink, TrpcTestProvider } from "../../helpers/trpc-fake";

/** Monterar komponenten under en fejkad tRPC-länk (registreringen svarar tomt). */
function renderNumbering(source: InvoiceNumberingSource | null) {
  const fake = fakeTrpcLink({ "document.register": () => ({}) });
  return render(<TrpcTestProvider link={fake.link}><ServerInvoiceNumbering store={source} /></TrpcTestProvider>);
}

function store(pending: boolean, invoiceNumber: string): InvoiceNumberingSource {
  return {
    hasPendingFor: () => pending,
    store: { invoices: { findUnique: async () => ({ invoiceNumber, ocrReference: null }) } },
  };
}

beforeEach(() => { setDeferredFakturaStoreForTests(new InMemoryDeferredFakturaStore()); });
afterEach(() => { setDeferredFakturaStoreForTests(null); });

describe("ServerInvoiceNumbering", () => {
  it("utan store → ingen resolver (lokalt nummer gäller)", async () => {
    const { container, unmount } = renderNumbering(null);
    expect(container.firstChild).toBeNull();
    expect(await finalInvoiceNumber("x")).toEqual({ state: "local" });
    unmount();
  });

  it("med store: köad faktura → pending; synkad → storens (serverns) nummer; avmontering avregistrerar", async () => {
    const pending = renderNumbering(store(true, "F-1"));
    expect(await finalInvoiceNumber("x")).toEqual({ state: "pending" });
    pending.unmount();
    const synced = renderNumbering(store(false, "F-2026-0005"));
    expect(await finalInvoiceNumber("x")).toEqual({ state: "final", invoiceNumber: "F-2026-0005", ocrReference: null });
    synced.unmount();
    expect(await finalInvoiceNumber("x")).toEqual({ state: "local" });
  });
});
