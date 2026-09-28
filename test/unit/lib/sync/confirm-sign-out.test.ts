/**
 * `confirmSignOutIfUnsynced` (#1241) — utloggning när ändringar inte nått
 * servern.
 *
 * Först görs ett sista försök att synka. Når allt fram loggas man ut utan
 * fråga; annars får användaren välja, med antalet osynkade ändringar i
 * frågan — en utloggning mitt i ett avbrott ska vara ett medvetet val.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { confirmSignOutIfUnsynced, unsyncedSignOutMessage } from "@/lib/client/sync/confirm-sign-out";

describe("confirmSignOutIfUnsynced", () => {
  it("allt synkat → ut direkt, ingen fråga", async () => {
    const confirm = vi.fn(() => true);
    const flush = vi.fn(async () => undefined);
    expect(await confirmSignOutIfUnsynced({ flush, pendingCount: () => 0, confirm })).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("sista synken lyckas → ingen fråga", async () => {
    let pending = 2;
    const confirm = vi.fn(() => false);
    const ok = await confirmSignOutIfUnsynced({ flush: async () => { pending = 0; }, pendingCount: () => pending, confirm });
    expect(ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("synken misslyckas (offline) → frågar med antalet; nej → stannar kvar", async () => {
    const confirm = vi.fn(() => false);
    const ok = await confirmSignOutIfUnsynced({
      flush: async () => { throw new Error("offline"); },
      pendingCount: () => 2,
      confirm,
    });
    expect(ok).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2 ändringar"));
  });

  it("… ja → loggas ut ändå", async () => {
    const ok = await confirmSignOutIfUnsynced({
      flush: async () => { throw new Error("offline"); },
      pendingCount: () => 1,
      confirm: () => true,
    });
    expect(ok).toBe(true);
  });
});

describe("confirmSignOutIfUnsynced — hängande server", () => {
  it("en synk som aldrig svarar väntas inte ut: frågan kommer efter tidsgränsen", async () => {
    const confirm = vi.fn(() => false);
    const ok = await confirmSignOutIfUnsynced({
      flush: () => new Promise<void>(() => {}),
      pendingCount: () => 1,
      confirm,
      flushTimeoutMs: 10,
    });
    expect(ok).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("unsyncedSignOutMessage", () => {
  it("singular och plural", () => {
    expect(unsyncedSignOutMessage(1)).toMatch(/^1 ändring har inte nått servern/);
    expect(unsyncedSignOutMessage(3)).toMatch(/^3 ändringar har inte nått servern/);
  });
  it("förklarar risken och vad man kan göra", () => {
    expect(unsyncedSignOutMessage(1)).toMatch(/kan gå förlorad/);
    expect(unsyncedSignOutMessage(1)).toMatch(/Logga ut ändå\?/);
  });
});
