import { describe, expect, it, vi } from "vitest-compat";
import { flushServerSync, registerServerSyncFlush } from "@/lib/client/sync/server-sync-flush";

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
});
