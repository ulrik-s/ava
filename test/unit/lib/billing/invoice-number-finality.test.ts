/**
 * `finalInvoiceNumber` (#1243) — är fakturans nummer fastställt?
 *
 * I demon (ingen server) är det lokala numret slutgiltigt. I self-hosted
 * sätter servern numret vid synk; tills dess är klientens nummer preliminärt,
 * och ett dokument med numret får inte skapas.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import {
  finalInvoiceNumber, registerInvoiceNumberResolver, storeInvoiceNumberResolver,
} from "@/lib/client/billing/invoice-number-finality";

let unregister: (() => void) | null = null;
afterEach(() => { unregister?.(); unregister = null; });

describe("finalInvoiceNumber", () => {
  it("ingen server (demo) → det lokala numret gäller", async () => {
    expect(await finalInvoiceNumber("inv")).toEqual({ state: "local" });
  });

  it("server-first: resolverns svar (fastställt nummer)", async () => {
    unregister = registerInvoiceNumberResolver(async (id) => ({ state: "final", invoiceNumber: `F-${id}`, ocrReference: "123" }));
    expect(await finalInvoiceNumber("x")).toEqual({ state: "final", invoiceNumber: "F-x", ocrReference: "123" });
  });

  it("server-first: ännu inte synkad → pending", async () => {
    unregister = registerInvoiceNumberResolver(async () => ({ state: "pending" }));
    expect(await finalInvoiceNumber("x")).toEqual({ state: "pending" });
  });

  it("avregistrering → tillbaka till lokalt; en gammal avregistrering rör inte en nyare", async () => {
    const a = registerInvoiceNumberResolver(async () => ({ state: "pending" }));
    unregister = registerInvoiceNumberResolver(async () => ({ state: "final", invoiceNumber: "F-1", ocrReference: null }));
    a();
    expect(await finalInvoiceNumber("x")).toMatchObject({ state: "final" });
    unregister();
    unregister = null;
    expect(await finalInvoiceNumber("x")).toEqual({ state: "local" });
  });
});

describe("storeInvoiceNumberResolver (self-hosted)", () => {
  it("synkar först; utan köad ändring för fakturan → den lokala (nu kanoniska) raden gäller", async () => {
    const flush = vi.fn(async () => undefined);
    const resolve = storeInvoiceNumberResolver({
      flush, hasPendingFor: () => false,
      readInvoice: async () => ({ invoiceNumber: "F-2026-0009", ocrReference: "9" }),
    });
    expect(await resolve("inv")).toEqual({ state: "final", invoiceNumber: "F-2026-0009", ocrReference: "9" });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("fakturan har en köad ändring (offline) → pending, även om synken kastar", async () => {
    const resolve = storeInvoiceNumberResolver({
      flush: async () => { throw new Error("offline"); }, hasPendingFor: (entity, id) => entity === "invoice" && id === "inv",
      readInvoice: async () => ({ invoiceNumber: "F-2026-0001", ocrReference: "1" }),
    });
    expect(await resolve("inv")).toEqual({ state: "pending" });
  });

  it("fakturan finns inte lokalt → pending (inget dokument för en okänd faktura)", async () => {
    const resolve = storeInvoiceNumberResolver({ flush: async () => undefined, hasPendingFor: () => false, readInvoice: async () => null });
    expect(await resolve("inv")).toEqual({ state: "pending" });
  });
});
