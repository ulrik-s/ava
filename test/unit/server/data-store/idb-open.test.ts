/**
 * Öppna IndexedDB utan att fastna (#1346): en blockerad öppning ger upp med
 * ett fel, och våra anslutningar stänger sig när en annan flik höjer versionen.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { openDatabase, openExistingDatabase } from "@/lib/server/data-store/in-memory/idb-open";

const noUpgrade = (): void => undefined;

/** En anslutning som en flik med gammal kod håller: ingen onversionchange. */
function hold(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("openDatabase", () => {
  it("en öppning som blockeras av en annan flik ger upp med ett fel och rapporteras — hänger aldrig", async () => {
    const factory = new IDBFactory();
    const held = await hold(factory, "o-blocked", 1);
    const report = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
    await expect(openDatabase({ factory, name: "o-blocked", version: 2, upgrade: noUpgrade, blockedTimeoutMs: 10 }))
      .rejects.toThrow(/hålls öppen av en annan flik/);
    expect(report).toHaveBeenCalledTimes(1);
    report.mockRestore();
    held.close(); // öppningen går igenom i efterhand — och stängs direkt
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await hold(factory, "o-blocked", 3);
    expect(after.version).toBe(3);
    after.close();
  });

  it("vår anslutning stänger sig när en annan flik höjer versionen, så den inte blockeras", async () => {
    const factory = new IDBFactory();
    const ours = await openDatabase({ factory, name: "o-yield", version: 1, upgrade: noUpgrade });
    const other = await openDatabase({ factory, name: "o-yield", version: 2, upgrade: noUpgrade, blockedTimeoutMs: 1_000 });
    expect(other.version).toBe(2);
    other.close();
    ours.close();
  });

  it("en blockering som löser sig i tid ger en anslutning", async () => {
    const factory = new IDBFactory();
    const held = await hold(factory, "o-unblock", 1);
    const opening = openDatabase({ factory, name: "o-unblock", version: 2, upgrade: noUpgrade, blockedTimeoutMs: 1_000 });
    setTimeout(() => held.close(), 5);
    const db = await opening;
    expect(db.version).toBe(2);
    db.close();
  });

  it("ett fel vid öppningen avvisas", async () => {
    const factory = new IDBFactory();
    (await hold(factory, "o-newer", 5)).close();
    await expect(openDatabase({ factory, name: "o-newer", version: 1, upgrade: noUpgrade })).rejects.toThrow();
  });
});

describe("openExistingDatabase", () => {
  it("en databas som inte finns skapas inte", async () => {
    const factory = new IDBFactory();
    expect(await openExistingDatabase(factory, "o-missing")).toBeNull();
    expect(await factory.databases()).toEqual([]);
  });

  it("en befintlig databas öppnas i sin version, och stänger sig vid en versionshöjning", async () => {
    const factory = new IDBFactory();
    (await hold(factory, "o-existing", 4)).close();
    const db = await openExistingDatabase(factory, "o-existing");
    expect(db?.version).toBe(4);
    const upgraded = await openDatabase({ factory, name: "o-existing", version: 5, upgrade: noUpgrade, blockedTimeoutMs: 1_000 });
    expect(upgraded.version).toBe(5);
    upgraded.close();
  });
});
