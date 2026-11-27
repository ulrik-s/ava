/**
 * IndexedDbPersistence (#412) — testas mot fake-indexeddb (happy-dom saknar
 * IndexedDB). Verifierar hydrate-på-tom → null, save→hydrate round-trip med
 * Date-bevaring, och att save skriver över föregående.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/client/local-store/cursor-store";
import { IdbKv } from "@/lib/client/local-store/idb-kv";
import { IndexedDbPersistence } from "@/lib/client/local-store/indexeddb-persistence";
import { LOCAL_DATA_VERSION, LocalDataTooNewError } from "@/lib/client/local-store/local-data-format";
import type { SnapshotMark, SnapshotMarks, SnapshotTab } from "@/lib/client/local-store/snapshot-marks";

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
    expect(await kv.get("format")).toBe(LOCAL_DATA_VERSION);
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

/**
 * Märkena (#1714): flera flikar delar snapshotet. En flik som sparar bär över
 * raderna för en annan fliks köade ändringar, och en ny flik läser om raderna
 * för poster som redan avgjorts.
 */
describe("IndexedDbPersistence — märken för köade ändringar (#1714)", () => {
  const ref = (id: string) => ({ entity: "user", id });

  /** En flik med en kö i minnet: `pending` är flikens egna poster, `queue` allt den känner till. */
  function tab(factory: IDBFactory, dbName: string, format?: ConstructorParameters<typeof IndexedDbPersistence>[2]) {
    const state = {
      pending: [] as SnapshotMark[],
      owed: [] as Array<{ entity: string; id: string }>,
      queue: [] as string[],
      /** Vad kön innehåller när fliken läser om den. */
      stored: null as string[] | null,
      adopted: undefined as SnapshotMarks | null | undefined,
      refreshes: 0,
    };
    const view: SnapshotTab = {
      marks: () => ({ pending: state.pending, owed: state.owed }),
      position: (id) => (state.queue.includes(id) ? state.queue.indexOf(id) : null),
      refresh: () => {
        state.refreshes++;
        if (state.stored) state.queue = state.stored;
        return Promise.resolve();
      },
      adopt: (stored) => { state.adopted = stored; },
    };
    const persistence = new IndexedDbPersistence(factory, dbName, format);
    persistence.attach(view);
    return { state, persistence, view };
  }

  const hydrateFresh = (factory: IDBFactory, dbName: string) => new IndexedDbPersistence(factory, dbName).hydrate();

  it("två flikar skriver inte bort varandras köade rader", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "marks-two-tabs");
    const b = tab(factory, "marks-two-tabs");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "u1" }, { id: "x", name: "köad" }] });
    // B känner inte till X: kön läses om, och raden bärs över.
    b.state.pending = [{ id: "Y", refs: [ref("y")] }];
    b.state.queue = ["Y"];
    b.state.stored = ["X", "Y"];
    await b.persistence.save({ users: [{ id: "u1" }, { id: "y" }] });

    expect(b.state.refreshes).toBe(1);
    expect(await hydrateFresh(factory, "marks-two-tabs")).toEqual({ users: [{ id: "u1" }, { id: "y" }, { id: "x", name: "köad" }] });
    expect(await new IdbKv(factory, "marks-two-tabs", "source").get("marks")).toEqual({
      pending: [{ id: "Y", refs: [ref("y")] }, { id: "X", refs: [ref("x")] }],
      owed: [],
    });
    // A sparar igen: B:s rad bärs över åt andra hållet, utan omläsning (A känner Y).
    a.state.queue = ["X", "Y"];
    await a.persistence.save({ users: [{ id: "u1" }, { id: "x", name: "köad" }] });
    expect(a.state.refreshes).toBe(0);
    expect((await hydrateFresh(factory, "marks-two-tabs"))?.users).toEqual([{ id: "u1" }, { id: "x", name: "köad" }, { id: "y" }]);
  });

  it("en lokal ändring mellan läsningarna: märkena hör till raderna som klonas", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "marks-late-change");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "x" }] });
    // B känner X och bär över raden, vilket kräver en läsning till. Mellan de
    // två svaren köar B posten Z och skriver dess rad i källan.
    const b = tab(factory, "marks-late-change");
    b.state.queue = ["X"];
    const source = { users: [{ id: "u1" }] };
    let reads = 0;
    b.view.marks = () => {
      if (++reads === 2) {
        b.state.pending = [{ id: "Z", refs: [ref("z")] }];
        source.users.push({ id: "z" });
      }
      return { pending: b.state.pending, owed: b.state.owed };
    };
    await b.persistence.save(source);

    expect(reads).toBe(2);
    expect((await hydrateFresh(factory, "marks-late-change"))?.users).toEqual([{ id: "u1" }, { id: "z" }, { id: "x" }]);
    expect(await new IdbKv(factory, "marks-late-change", "source").get("marks")).toEqual({
      pending: [{ id: "Z", refs: [ref("z")] }, { id: "X", refs: [ref("x")] }],
      owed: [],
    });
  });

  it("en märkt post som är avgjord bärs inte över: de provisoriska raderna försvinner", async () => {
    const factory = new IDBFactory();
    const b = tab(factory, "marks-settled");
    b.state.pending = [{ id: "P", refs: [ref("prov")] }];
    b.state.queue = ["P"];
    await b.persistence.save({ users: [{ id: "u1" }, { id: "prov" }] });
    // A har kvitterat P: efter omläsningen ligger den fortfarande inte i kön.
    const a = tab(factory, "marks-settled");
    a.state.stored = [];
    await a.persistence.save({ users: [{ id: "u1" }, { id: "srv" }] });

    expect(a.state.refreshes).toBe(1);
    expect(await hydrateFresh(factory, "marks-settled")).toEqual({ users: [{ id: "u1" }, { id: "srv" }] });
    expect(await new IdbKv(factory, "marks-settled", "source").get("marks")).toEqual({ pending: [], owed: [] });
  });

  it("flikens rader att läsa om (owed) sparas med snapshotet", async () => {
    const factory = new IDBFactory();
    const b = tab(factory, "marks-owed");
    b.state.owed = [ref("prov")];
    await b.persistence.save({ users: [{ id: "prov" }] });
    const fresh = tab(factory, "marks-owed");
    await fresh.persistence.hydrate();
    expect(fresh.state.adopted).toEqual({ pending: [], owed: [ref("prov")] });
  });

  it("hydrate lämnar märkena till fliken; utan snapshot lämnas inga", async () => {
    const factory = new IDBFactory();
    const empty = tab(factory, "marks-hydrate");
    expect(await empty.persistence.hydrate()).toBeNull();
    expect(empty.state.adopted).toBeUndefined();

    const a = tab(factory, "marks-hydrate");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "x" }] });
    const fresh = tab(factory, "marks-hydrate");
    expect(await fresh.persistence.hydrate()).toEqual({ users: [{ id: "x" }] });
    expect(fresh.state.adopted).toEqual({ pending: [{ id: "X", refs: [ref("x")] }], owed: [] });
  });

  it("ett snapshot i format 2 (före #1714) lyfts utan förlust; märken saknas", async () => {
    const factory = new IDBFactory();
    const kv = new IdbKv(factory, "marks-format-2", "source");
    await kv.putAll([["current", { users: [{ id: "u1" }, { id: "köad" }] }], ["format", 2], ["sync", { cursor: 4 }]]);

    const t = tab(factory, "marks-format-2");
    t.state.pending = [{ id: "X", refs: [ref("köad")] }];
    t.state.queue = ["X"];
    expect(await t.persistence.hydrate()).toEqual({ users: [{ id: "u1" }, { id: "köad" }] });
    expect(t.state.adopted).toBeNull();
    expect(await kv.get("format")).toBe(LOCAL_DATA_VERSION);
    expect(await kv.get("current")).toEqual({ users: [{ id: "u1" }, { id: "köad" }] });
    expect(await kv.get("marks")).toEqual({ pending: [{ id: "X", refs: [ref("köad")] }], owed: [] });
  });

  it("ett nyare format: LocalDataTooNewError, och varken rader eller märken skrivs", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "marks-too-new");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "x" }] });
    const kv = new IdbKv(factory, "marks-too-new", "source");
    await kv.put("format", LOCAL_DATA_VERSION + 1);

    const b = tab(factory, "marks-too-new");
    let refused: unknown = null;
    await b.persistence.save({ users: [{ id: "u2" }] }).catch((e: unknown) => { refused = e; });
    expect(refused).toBeInstanceOf(LocalDataTooNewError);
    await expect(b.persistence.hydrate()).rejects.toBeInstanceOf(LocalDataTooNewError);
    expect(await kv.get("current")).toEqual({ users: [{ id: "x" }] });
    expect(await kv.get("marks")).toEqual({ pending: [{ id: "X", refs: [ref("x")] }], owed: [] });
  });

  it("en flik med äldre kod (format 2) skriver inte ett snapshot utan märken över ett med", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "marks-old-tab");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "x" }] });

    const old = new IndexedDbPersistence(factory, "marks-old-tab", { version: 2, migrations: {} });
    let refused: unknown = null;
    await old.save({ users: [] }).catch((e: unknown) => { refused = e; });
    expect(refused).toBeInstanceOf(LocalDataTooNewError);
    expect(await new IdbKv(factory, "marks-old-tab", "source").get("current")).toEqual({ users: [{ id: "x" }] });
  });

  it("utan kopplad flik (tester, demo) sparas källan som den är, och gamla märken töms", async () => {
    const factory = new IDBFactory();
    const a = tab(factory, "marks-no-tab");
    a.state.pending = [{ id: "X", refs: [ref("x")] }];
    a.state.queue = ["X"];
    await a.persistence.save({ users: [{ id: "x" }] });

    await new IndexedDbPersistence(factory, "marks-no-tab").save({ users: [{ id: "u2" }] });
    expect(await hydrateFresh(factory, "marks-no-tab")).toEqual({ users: [{ id: "u2" }] });
    expect(await new IdbKv(factory, "marks-no-tab", "source").get("marks")).toEqual({ pending: [], owed: [] });
  });

  it("trasiga lagrade märken räknas som inga", async () => {
    const factory = new IDBFactory();
    const kv = new IdbKv(factory, "marks-broken", "source");
    await kv.putAll([["current", { users: [{ id: "u1" }] }], ["format", LOCAL_DATA_VERSION], ["marks", "trasig"]]);
    const t = tab(factory, "marks-broken");
    expect(await t.persistence.hydrate()).toEqual({ users: [{ id: "u1" }] });
    expect(t.state.adopted).toBeNull();
    await t.persistence.save({ users: [{ id: "u2" }] });
    expect(await kv.get("current")).toEqual({ users: [{ id: "u2" }] });
  });
});
