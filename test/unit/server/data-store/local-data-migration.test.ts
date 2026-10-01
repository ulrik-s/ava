/**
 * Lokala data mellan app-versioner (#1269) — snapshotet och kön i IndexedDB
 * överlever uppgraderingar. Ingenting får tappas tyst.
 *
 * Fixturen `release-2026-09.json` är det en klient skrev före #1269: snapshot
 * utan formatversion, köposter utan formatstämpel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { LOCAL_DATA_VERSION, LocalDataTooNewError, migrateLocalSnapshot } from "@/lib/server/data-store/in-memory/local-data-format";
import { IndexedDbMutationQueuePersistence, MutationQueue } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { DemoSource } from "@/lib/shared/demo-source";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/local-data/release-2026-09.json"), "utf8")) as {
  snapshot: DemoSource; queue: unknown[];
};

/** Skriv lokala data så som den förra releasen gjorde (ingen formatnyckel). */
async function writePreviousRelease(factory: IDBFactory, dbName: string): Promise<void> {
  await new IdbKv(factory, dbName, "source").put("current", fixture.snapshot);
}

describe("snapshot från förra releasen (#1269)", () => {
  it("läses utan att en rad tappas", async () => {
    const factory = new IDBFactory();
    await writePreviousRelease(factory, "ava-prev");
    const source = await new IndexedDbPersistence(factory, "ava-prev").hydrate();
    expect(source).toEqual(fixture.snapshot);
  });

  it("sparas därefter med dagens formatversion", async () => {
    const factory = new IDBFactory();
    await writePreviousRelease(factory, "ava-prev-save");
    const p = new IndexedDbPersistence(factory, "ava-prev-save");
    await p.save((await p.hydrate()) ?? {});
    expect(await new IdbKv(factory, "ava-prev-save", "source").get("format")).toBe(LOCAL_DATA_VERSION);
  });

  it("ett äldre format lyfts steg för steg och sparas i dagens", async () => {
    const factory = new IDBFactory();
    await writePreviousRelease(factory, "ava-migrate");
    const renameTitle = (s: DemoSource): DemoSource => ({
      ...s, matters: (s.matters ?? []).map((m) => ({ ...m, rubrik: (m as { title?: string }).title })),
    });
    const p = new IndexedDbPersistence(factory, "ava-migrate", { version: 2, migrations: { 1: renameTitle } });
    const source = await p.hydrate();
    expect(source?.matters?.[0]).toMatchObject({ rubrik: "Tvist om hyra" });
    const kv = new IdbKv(factory, "ava-migrate", "source");
    expect(await kv.get("format")).toBe(2);
    expect((await kv.get<DemoSource>("current"))?.matters?.[0]).toMatchObject({ rubrik: "Tvist om hyra" });
  });

  it("data från en nyare version → tydligt besked, och ingenting skrivs över", async () => {
    const factory = new IDBFactory();
    await writePreviousRelease(factory, "ava-newer");
    const kv = new IdbKv(factory, "ava-newer", "source");
    await kv.put("format", LOCAL_DATA_VERSION + 1);
    await expect(new IndexedDbPersistence(factory, "ava-newer").hydrate()).rejects.toThrow(LocalDataTooNewError);
    expect(await kv.get("current")).toEqual(fixture.snapshot);
    expect(await kv.get("format")).toBe(LOCAL_DATA_VERSION + 1);
  });
});

describe("spara snapshotet (#1362)", () => {
  it("snapshot och formatversion skrivs i samma transaktion", async () => {
    const factory = new IDBFactory();
    const p = new IndexedDbPersistence(factory, "ava-atomic");
    await p.save(fixture.snapshot);
    const kv = new IdbKv(factory, "ava-atomic", "source");
    expect(await kv.get("current")).toEqual(fixture.snapshot);
    expect(await kv.get("format")).toBe(LOCAL_DATA_VERSION);
  });

  it("en flik med äldre kod skriver inte över en nyare versions data — LocalDataTooNewError", async () => {
    const factory = new IDBFactory();
    await writePreviousRelease(factory, "ava-older-tab");
    const kv = new IdbKv(factory, "ava-older-tab", "source");
    await kv.put("format", LOCAL_DATA_VERSION + 1);
    await expect(new IndexedDbPersistence(factory, "ava-older-tab").save({ users: [] })).rejects.toThrow(LocalDataTooNewError);
    expect(await kv.get("current")).toEqual(fixture.snapshot);
    expect(await kv.get("format")).toBe(LOCAL_DATA_VERSION + 1);
  });
});

describe("IdbKv.putAll (#1362)", () => {
  it("allt eller inget: ett villkor som kastar avbryter hela skrivningen", async () => {
    const kv = new IdbKv(new IDBFactory(), "ava-putall", "s");
    await kv.putAll([["a", 1], ["b", 2]], { key: "a", check: () => undefined });
    expect([await kv.get("a"), await kv.get("b")]).toEqual([1, 2]);
    const refusal = new Error("nej");
    await expect(kv.putAll([["a", 9], ["b", 9]], { key: "a", check: (stored) => { if (stored === 1) throw refusal; } })).rejects.toBe(refusal);
    expect([await kv.get("a"), await kv.get("b")]).toEqual([1, 2]);
  });
});

describe("migrateLocalSnapshot", () => {
  it("beskedet säger vad användaren ska göra", () => {
    expect(() => migrateLocalSnapshot({}, 9, {}, 1)).toThrow(/Ladda om sidan.*ingenting har raderats/);
  });

  it("ett saknat migreringssteg kastar hellre än att läsa fel format", () => {
    expect(() => migrateLocalSnapshot({}, 1, {}, 2)).toThrow(/Ingen migrering av lokala data från format 1 till 2/);
  });

  it("aktuellt format → oförändrat, inget att spara", () => {
    const source = { users: [] };
    expect(migrateLocalSnapshot(source, LOCAL_DATA_VERSION)).toEqual({ source, migrated: false });
  });
});

describe("kön från förra releasen (#1269)", () => {
  it("alla köade ändringar finns kvar efter uppgraderingen — ingen tyst borttagning", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "ava-queue-prev", "queue").put("pending", fixture.queue);
    const queue = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "ava-queue-prev"));
    expect(queue.pending()).toEqual(fixture.queue);
  });
});
