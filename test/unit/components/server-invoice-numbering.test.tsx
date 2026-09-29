/**
 * `ServerInvoiceNumbering` (#1243) — monterad i self-hosted-trädet kopplar den
 * in resolvern mot klientstoren; utan store (under uppstart) gör den ingenting.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { type InvoiceNumberingSource, ServerInvoiceNumbering } from "@/components/shell/server-invoice-numbering";
import { InMemoryDeferredFakturaStore, setDeferredFakturaStoreForTests } from "@/lib/client/billing/deferred-faktura-docs";
import { finalInvoiceNumber } from "@/lib/client/billing/invoice-number-finality";

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: { register: { useMutation: () => ({ mutateAsync: async () => ({}) }) } },
    useUtils: () => ({ document: { tree: { invalidate: async () => {}, refetch: async () => {} }, list: { invalidate: async () => {} } } }),
  },
}));

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
    const { container, unmount } = render(<ServerInvoiceNumbering store={null} />);
    expect(container.firstChild).toBeNull();
    expect(await finalInvoiceNumber("x")).toEqual({ state: "local" });
    unmount();
  });

  it("med store: köad faktura → pending; synkad → storens (serverns) nummer; avmontering avregistrerar", async () => {
    const pending = render(<ServerInvoiceNumbering store={store(true, "F-1")} />);
    expect(await finalInvoiceNumber("x")).toEqual({ state: "pending" });
    pending.unmount();
    const synced = render(<ServerInvoiceNumbering store={store(false, "F-2026-0005")} />);
    expect(await finalInvoiceNumber("x")).toEqual({ state: "final", invoiceNumber: "F-2026-0005", ocrReference: null });
    synced.unmount();
    expect(await finalInvoiceNumber("x")).toEqual({ state: "local" });
  });
});
