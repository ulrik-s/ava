/**
 * Fakturadokument skapas först när numret är fastställt (#1243).
 *
 * Dokumentet bär fakturanumret. Skapas det offline med klientens preliminära
 * nummer, och servern sedan sätter ett annat, ligger ett dokument med fel
 * nummer i ärendet. Därför:
 *   - fastställt (synkat) → dokumentet får SERVERNS nummer,
 *   - inte synkat än → dokumentet skjuts upp (persistent) och skapas efter synk,
 *   - demo (ingen server) → som förut, direkt med det lokala numret.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { IndexedDbListStore } from "@/lib/client/backend/idb-list-store";
import { deferredFakturaStore, InMemoryDeferredFakturaStore, setDeferredFakturaStoreForTests } from "@/lib/client/billing/deferred-faktura-docs";
import { registerInvoiceNumberResolver, type InvoiceNumberState } from "@/lib/client/billing/invoice-number-finality";
import { processDeferredFakturaDocs } from "@/lib/client/billing/process-deferred-faktura-docs";
import { generateFakturaFromTemplate, type DocUtils, type RegisterMut } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { asId } from "@/lib/shared/schemas/ids";

vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc: vi.fn(async () => {}) }));

const utils: DocUtils = {
  document: {
    tree: { invalidate: async () => undefined, refetch: async () => undefined },
    list: { invalidate: async () => undefined },
  },
};

function harness(state: () => InvoiceNumberState) {
  const registered: Array<{ fileName: string }> = [];
  const register: RegisterMut = { mutateAsync: async (i) => { registered.push(i as { fileName: string }); return {}; } };
  const unregister = registerInvoiceNumberResolver(async () => state());
  const store = new InMemoryDeferredFakturaStore();
  setDeferredFakturaStoreForTests(store);
  return { registered, register, unregister, store };
}

const args = (register: RegisterMut) => ({
  invoice: { id: asId<"InvoiceId">("0190a1b2-0000-7000-8000-00000000f001"), amount: 125_00, invoiceNumber: "F-2026-0001", ocrReference: "1", invoiceDate: "2026-09-29" },
  matterId: asId<"MatterId">("0190a1b2-0000-7000-8000-00000000a001"),
  recipient: "Klient AB",
  meta: { matterNumber: "2026-0001", matterTitle: "Tvist" },
  register, utils,
});

let cleanup: Array<() => void> = [];
afterEach(() => { for (const c of cleanup) c(); cleanup = []; setDeferredFakturaStoreForTests(null); });

describe("generateFakturaFromTemplate — fastställt nummer", () => {
  it("synkad faktura → dokumentet får serverns nummer, inte det preliminära", async () => {
    const h = harness(() => ({ state: "final", invoiceNumber: "F-2026-0007", ocrReference: "7" }));
    cleanup.push(h.unregister);
    expect(await generateFakturaFromTemplate(args(h.register))).toBe("generated");
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0]!.fileName).toContain("F-2026-0007");
  });

  it("inte synkad → inget dokument nu; uppskjutet med fakturans uppgifter", async () => {
    const h = harness(() => ({ state: "pending" }));
    cleanup.push(h.unregister);
    expect(await generateFakturaFromTemplate(args(h.register))).toBe("deferred");
    expect(h.registered).toHaveLength(0);
    const pending = await h.store.load();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ invoiceId: "0190a1b2-0000-7000-8000-00000000f001", recipient: "Klient AB" });
  });

  it("demo (ingen resolver) → direkt med det lokala numret", async () => {
    const registered: Array<{ fileName: string }> = [];
    const register: RegisterMut = { mutateAsync: async (i) => { registered.push(i as { fileName: string }); return {}; } };
    expect(await generateFakturaFromTemplate(args(register))).toBe("generated");
    expect(registered[0]!.fileName).toContain("F-2026-0001");
  });
});

describe("processDeferredFakturaDocs — efter synk", () => {
  it("när numret fastställts skapas dokumentet med serverns nummer och posten tas bort", async () => {
    let state: InvoiceNumberState = { state: "pending" };
    const h = harness(() => state);
    cleanup.push(h.unregister);
    await generateFakturaFromTemplate(args(h.register));
    state = { state: "final", invoiceNumber: "F-2026-0003", ocrReference: "3" };
    expect(await processDeferredFakturaDocs({ register: h.register, utils })).toBe(1);
    expect(h.registered[0]!.fileName).toContain("F-2026-0003");
    expect(await h.store.load()).toHaveLength(0);
  });

  it("fortfarande inte synkad → ligger kvar, inget dokument", async () => {
    const h = harness(() => ({ state: "pending" }));
    cleanup.push(h.unregister);
    await generateFakturaFromTemplate(args(h.register));
    expect(await processDeferredFakturaDocs({ register: h.register, utils })).toBe(0);
    expect(await h.store.load()).toHaveLength(1);
  });

  it("ett fel för ett dokument stoppar inte de andra, och den felade ligger kvar", async () => {
    let state: InvoiceNumberState = { state: "pending" };
    const h = harness(() => state);
    cleanup.push(h.unregister);
    await generateFakturaFromTemplate(args(h.register));
    await generateFakturaFromTemplate({ ...args(h.register), invoice: { ...args(h.register).invoice, id: asId<"InvoiceId">("0190a1b2-0000-7000-8000-00000000f002") } });
    state = { state: "final", invoiceNumber: "F-2026-0004", ocrReference: null };
    let calls = 0;
    const flaky: RegisterMut = { mutateAsync: async (i) => { calls++; if (calls === 1) throw new Error("nätfel"); h.registered.push(i as { fileName: string }); return {}; } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await processDeferredFakturaDocs({ register: flaky, utils })).toBe(1);
    expect(await h.store.load()).toHaveLength(1);
    warn.mockRestore();
  });

  it("samma faktura skjuts bara upp en gång", async () => {
    const h = harness(() => ({ state: "pending" }));
    cleanup.push(h.unregister);
    await generateFakturaFromTemplate(args(h.register));
    await generateFakturaFromTemplate(args(h.register));
    expect(await h.store.load()).toHaveLength(1);
  });
});

describe("lagringen", () => {
  it("utan testlagring → IndexedDB (överlever omladdning), samma instans varje gång", () => {
    setDeferredFakturaStoreForTests(null);
    const store = deferredFakturaStore();
    expect(store).toBeInstanceOf(IndexedDbListStore);
    expect(deferredFakturaStore()).toBe(store);
  });
});
