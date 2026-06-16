/**
 * IndexedDbPersistence (#412) — testas mot fake-indexeddb (happy-dom saknar
 * IndexedDB). Verifierar hydrate-på-tom → null, save→hydrate round-trip med
 * Date-bevaring, och att save skriver över föregående.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";

describe("IndexedDbPersistence", () => {
  it("hydrate på tom DB → null", async () => {
    const p = new IndexedDbPersistence(new IDBFactory(), "ava-test-empty");
    expect(await p.hydrate()).toBeNull();
  });

  it("save → hydrate round-trippar och bevarar Date", async () => {
    const p = new IndexedDbPersistence(new IDBFactory(), "ava-test-roundtrip");
    const invoiceDate = new Date("2026-06-16T08:00:00.000Z");
    await p.save({ invoices: [{ id: "i1", invoiceDate }] });

    const out = await p.hydrate();
    const row = out?.invoices?.[0] as { id: string; invoiceDate: Date } | undefined;
    expect(row?.id).toBe("i1");
    expect(row?.invoiceDate).toBeInstanceOf(Date);
    expect(row?.invoiceDate.getTime()).toBe(invoiceDate.getTime());
  });

  it("save skriver över föregående källa", async () => {
    const p = new IndexedDbPersistence(new IDBFactory(), "ava-test-overwrite");
    await p.save({ users: [{ id: "u1" }] });
    await p.save({ users: [{ id: "u2" }] });
    const out = await p.hydrate();
    expect(out?.users).toEqual([{ id: "u2" }]);
  });
});
