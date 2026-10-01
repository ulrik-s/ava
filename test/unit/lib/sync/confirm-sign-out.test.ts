/**
 * `syncBeforeSignOut` (#1241, #1347) — utloggning när ändringar inte nått
 * servern.
 *
 * Först görs ett sista försök att synka; svaret är antalet ändringar som ändå
 * inte nått fram. Är det noll loggas man ut utan fråga; annars frågar dialogen.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { syncBeforeSignOut, unsyncedSignOutMessage } from "@/lib/client/sync/confirm-sign-out";

describe("syncBeforeSignOut", () => {
  it("synkar en gång och svarar med det som är kvar", async () => {
    const flush = vi.fn(async () => undefined);
    expect(await syncBeforeSignOut({ flush, pendingCount: () => 0 })).toBe(0);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("sista synken lyckas → inget kvar", async () => {
    let pending = 2;
    expect(await syncBeforeSignOut({ flush: async () => { pending = 0; }, pendingCount: () => pending })).toBe(0);
  });

  it("synken misslyckas (offline) → antalet som inte nått fram", async () => {
    expect(await syncBeforeSignOut({ flush: async () => { throw new Error("offline"); }, pendingCount: () => 2 })).toBe(2);
  });

  it("en synk som aldrig svarar väntas inte ut", async () => {
    expect(await syncBeforeSignOut({ flush: () => new Promise<void>(() => {}), pendingCount: () => 1, flushTimeoutMs: 10 })).toBe(1);
  });

  it("utan injicerade beroenden: ingen server-synk → noll", async () => {
    expect(await syncBeforeSignOut()).toBe(0);
  });
});

describe("unsyncedSignOutMessage", () => {
  it("singular och plural", () => {
    expect(unsyncedSignOutMessage(1)).toBe("Du har 1 osynkad ändring.");
    expect(unsyncedSignOutMessage(3)).toBe("Du har 3 osynkade ändringar.");
  });
});
