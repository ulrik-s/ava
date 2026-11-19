/**
 * IndexedDbPersistence (#412) — testas mot fake-indexeddb (happy-dom saknar
 * IndexedDB). Verifierar hydrate-på-tom → null, save→hydrate round-trip med
 * Date-bevaring, och att save skriver över föregående.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { LocalDataTooNewError } from "@/lib/server/data-store/in-memory/local-data-format";

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

/**
 * Synkpositionen (#1711): flikens cursor och epok sparas i samma transaktion
 * som snapshotet, och läses tillsammans med det. Positionen på disk är aldrig
 * före snapshotet bredvid.
 */
describe("IndexedDbPersistence — synkpositionen (#1711)", () => {
  const EPOCH = "01a0f754-b809-7662-8de5-646987f19b9e";

  /** En flik: en egen position i minnet över den gemensamma lagringen. */
  function tab(factory: IDBFactory, dbName: string, format?: ConstructorParameters<typeof IndexedDbPersistence>[2]) {
    const cursor = new InMemoryCursorStore();
    return { cursor, persistence: new IndexedDbPersistence(factory, dbName, format, cursor) };
  }

  it("save sparar positionen med snapshotet; en ny flik fortsätter från den", async () => {
    const factory = new IDBFactory();
    const first = tab(factory, "pos-roundtrip");
    await first.cursor.set(5);
    await first.cursor.setEpoch(EPOCH);
    await first.persistence.save({ users: [{ id: "u1" }] });

    const reloaded = tab(factory, "pos-roundtrip");
    expect(await reloaded.persistence.hydrate()).toEqual({ users: [{ id: "u1" }] });
    expect(reloaded.cursor.position()).toEqual({ cursor: 5, epoch: EPOCH });
  });

  it("positionen når lagringen bara tillsammans med ett snapshot", async () => {
    const factory = new IDBFactory();
    const first = tab(factory, "pos-with-snapshot");
    await first.cursor.set(3);
    await first.persistence.save({ users: [{ id: "u1" }] });
    // Cursorn flyttas i minnet, men snapshotet sparas aldrig (fliken stängs).
    await first.cursor.set(9);

    const reloaded = tab(factory, "pos-with-snapshot");
    await reloaded.persistence.hydrate();
    expect(reloaded.cursor.position()).toEqual({ cursor: 3 });
  });

  it("en save som avvisas lämnar den sparade positionen orörd", async () => {
    const factory = new IDBFactory();
    const first = tab(factory, "pos-refused");
    await first.cursor.set(3);
    await first.persistence.save({ users: [{ id: "u1" }] });
    const kv = new IdbKv(factory, "pos-refused", "source");
    await kv.put("format", 99);

    await first.cursor.set(9);
    let refused: unknown = null;
    await first.persistence.save({ users: [{ id: "u2" }] }).catch((e: unknown) => { refused = e; });
    expect(refused).toBeInstanceOf(Error);
    expect(await kv.get("sync")).toEqual({ cursor: 3 });
    expect(await kv.get("current")).toEqual({ users: [{ id: "u1" }] });
  });

  it("utan snapshot läses ingen position, även om en finns sparad", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "pos-orphan", "source").put("sync", { cursor: 8, epoch: EPOCH });
    const t = tab(factory, "pos-orphan");
    expect(await t.persistence.hydrate()).toBeNull();
    expect(t.cursor.position()).toEqual({ cursor: 0 });
  });

  it("en trasig sparad position räknas som ingen: synken börjar från 0", async () => {
    const factory = new IDBFactory();
    const first = tab(factory, "pos-broken");
    await first.persistence.save({ users: [{ id: "u1" }] });
    await new IdbKv(factory, "pos-broken", "source").put("sync", { cursor: "sju" });

    const reloaded = tab(factory, "pos-broken");
    await reloaded.cursor.set(4);
    await reloaded.persistence.hydrate();
    expect(reloaded.cursor.position()).toEqual({ cursor: 0 });
  });

  it("två flikar: den som skriver sist skriver sina rader OCH sin position", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "pos-two-tabs");
    const b = tab(factory, "pos-two-tabs");
    await a.cursor.set(2);
    await a.persistence.save({ users: [{ id: "u1" }, { id: "u2" }] });
    // B har inte hämtat u2 (cursor 1) och sparar sist.
    await b.cursor.set(1);
    await b.persistence.save({ users: [{ id: "u1" }] });

    const fresh = tab(factory, "pos-two-tabs");
    expect(await fresh.persistence.hydrate()).toEqual({ users: [{ id: "u1" }] });
    expect(fresh.cursor.position()).toEqual({ cursor: 1 });
    // A tar inte över B:s position: den är kvar i A:s minne.
    expect(a.cursor.position()).toEqual({ cursor: 2 });
  });

  it("ett snapshot från före #1711 (format 1) lyfts och synkar från 0", async () => {
    const factory = new IDBFactory();
    const kv = new IdbKv(factory, "pos-format-1", "source");
    await kv.putAll([["current", { users: [{ id: "u1" }] }], ["format", 1]]);

    const t = tab(factory, "pos-format-1");
    expect(await t.persistence.hydrate()).toEqual({ users: [{ id: "u1" }] });
    expect(t.cursor.position()).toEqual({ cursor: 0 });
    expect(await kv.get("format")).toBe(2);
    expect(await kv.get("sync")).toEqual({ cursor: 0 });
  });

  it("en flik med äldre kod (format 1) skriver inte ett snapshot utan position över ett med", async () => {
    const factory = new IDBFactory();
    const current = tab(factory, "pos-old-tab");
    await current.cursor.set(6);
    await current.persistence.save({ users: [{ id: "u1" }, { id: "u2" }] });

    const old = new IndexedDbPersistence(factory, "pos-old-tab", { version: 1, migrations: {} });
    let refused: unknown = null;
    await old.save({ users: [{ id: "u1" }] }).catch((e: unknown) => { refused = e; });
    expect(refused).toBeInstanceOf(LocalDataTooNewError);
    const kv = new IdbKv(factory, "pos-old-tab", "source");
    expect(await kv.get("current")).toEqual({ users: [{ id: "u1" }, { id: "u2" }] });
    expect(await kv.get("sync")).toEqual({ cursor: 6 });
  });

  it("utan positionshållare (tester, demo) skrivs ingen position", async () => {
    const factory = new IDBFactory();
    const p = new IndexedDbPersistence(factory, "pos-none");
    await p.save({ users: [{ id: "u1" }] });
    expect(await new IdbKv(factory, "pos-none", "source").get("sync")).toBeNull();
    expect(await p.hydrate()).toEqual({ users: [{ id: "u1" }] });
  });
});
