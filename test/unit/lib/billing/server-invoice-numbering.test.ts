/**
 * `startServerInvoiceNumbering` (#1243) — kopplar in numreringen i
 * self-hosted: resolvern mot klientstoren, och uppskjutna fakturadokument som
 * skapas efter varje lyckad synk (och en gång vid start — de kan ligga kvar
 * från förra sessionen).
 */
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { InMemoryDeferredFakturaStore, setDeferredFakturaStoreForTests } from "@/lib/client/billing/deferred-faktura-docs";
import { finalInvoiceNumber } from "@/lib/client/billing/invoice-number-finality";
import { startServerInvoiceNumbering } from "@/lib/client/billing/server-invoice-numbering";
import type { DocUtils, RegisterMut } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { notifyServerSynced } from "@/lib/client/sync/server-sync-flush";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc: vi.fn(async () => {}) }));

const utils: DocUtils = {
  document: { tree: { invalidate: async () => undefined, refetch: async () => undefined }, list: { invalidate: async () => undefined } },
};
const INV = "0190a1b2-0000-7000-8000-00000000f010";

function fakeStore(opts: { pending: boolean; number: string }) {
  return {
    hasPendingFor: (entity: string, id: string) => opts.pending && entity === "invoice" && id === INV,
    readInvoice: async () => ({ invoiceNumber: opts.number, ocrReference: null }),
  };
}

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; setDeferredFakturaStoreForTests(null); });

describe("startServerInvoiceNumbering", () => {
  it("registrerar resolvern mot storen — och avregistrerar vid stopp", async () => {
    setDeferredFakturaStoreForTests(new InMemoryDeferredFakturaStore());
    stop = startServerInvoiceNumbering({ store: fakeStore({ pending: true, number: "F-1" }), register: { mutateAsync: async () => ({}) }, utils });
    expect(await finalInvoiceNumber(INV)).toEqual({ state: "pending" });
    stop();
    stop = null;
    expect(await finalInvoiceNumber(INV)).toEqual({ state: "local" });
  });

  it("efter en lyckad synk skapas uppskjutna dokument med serverns nummer", async () => {
    const deferred = new InMemoryDeferredFakturaStore();
    setDeferredFakturaStoreForTests(deferred);
    await deferred.save([{
      invoiceId: INV, invoice: { id: asId<"InvoiceId">(INV), amount: 1, invoiceNumber: "F-preliminärt" },
      matterId: asId<"MatterId">("0190a1b2-0000-7000-8000-00000000a010"), recipient: "K", meta: { matterNumber: "1", matterTitle: "T" },
    }]);
    const s = { pending: true, number: "F-2026-0042" };
    const registered: string[] = [];
    const register: RegisterMut = { mutateAsync: async (i) => { registered.push((i as { fileName: string }).fileName); return {}; } };
    stop = startServerInvoiceNumbering({ store: fakeStore(s), register, utils });
    await waitFor(async () => expect(await deferred.load()).toHaveLength(1)); // start-körningen: inte synkad än
    s.pending = false;
    notifyServerSynced();
    await waitFor(async () => expect(registered).toHaveLength(1));
    expect(registered[0]).toContain("F-2026-0042");
    expect(await deferred.load()).toHaveLength(0);
  });
});
