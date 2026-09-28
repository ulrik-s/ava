import { describe, expect, it, vi } from "vitest-compat";
import { flushServerSync, registerServerSyncFlush, unsyncedChangeCount } from "@/lib/client/sync/server-sync-flush";

describe("server-sync-flush", () => {
  it("no-op utan registrerad synk", async () => {
    await expect(flushServerSync()).resolves.toBeUndefined();
  });

  it("anropar den registrerade; en gammal avregistrering rör inte en nyare", async () => {
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    const unA = registerServerSyncFlush(a);
    const unB = registerServerSyncFlush(b);
    unA();
    await flushServerSync();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    unB();
    await flushServerSync();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsyncedChangeCount (#1241): 0 utan synk, annars den registrerade räknaren", () => {
    expect(unsyncedChangeCount()).toBe(0);
    let pending = 3;
    const un = registerServerSyncFlush(async () => undefined, () => pending);
    expect(unsyncedChangeCount()).toBe(3);
    pending = 0;
    expect(unsyncedChangeCount()).toBe(0);
    un();
    pending = 5;
    expect(unsyncedChangeCount()).toBe(0);
  });

  it("utan räknare räknas ingenting som osynkat", () => {
    const un = registerServerSyncFlush(async () => undefined);
    expect(unsyncedChangeCount()).toBe(0);
    un();
  });
});
