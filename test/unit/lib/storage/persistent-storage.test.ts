/**
 * `ensurePersistentStorage` (#1241) — ber webbläsaren att inte rensa AVA:s
 * lokala lagring (IndexedDB med osynkade ändringar).
 *
 * Utan `navigator.storage.persist()` är lagringen "best effort": webbläsaren får
 * tömma den vid lagringsbrist, och Safari rensar skriptlagrad data efter en
 * tids inaktivitet. Då försvinner ändringar som ännu inte nått servern.
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import {
  ensurePersistentStorage,
  requestPersistentStorageOnce,
  resetPersistentStorageRequestForTests,
  type StorageManagerLike,
} from "@/lib/client/storage/persistent-storage";

function manager(opts: { persisted?: boolean; grant?: boolean; throws?: boolean } = {}): StorageManagerLike & {
  persist: ReturnType<typeof vi.fn>;
  persisted: ReturnType<typeof vi.fn>;
} {
  return {
    persisted: vi.fn(async () => opts.persisted ?? false),
    persist: vi.fn(async () => {
      if (opts.throws) throw new Error("SecurityError");
      return opts.grant ?? false;
    }),
  };
}

describe("ensurePersistentStorage", () => {
  it("redan beständig → frågar inte igen", async () => {
    const m = manager({ persisted: true });
    expect(await ensurePersistentStorage(m)).toBe("persisted");
    expect(m.persist).not.toHaveBeenCalled();
  });

  it("webbläsaren beviljar → persisted", async () => {
    const m = manager({ grant: true });
    expect(await ensurePersistentStorage(m)).toBe("persisted");
    expect(m.persist).toHaveBeenCalledTimes(1);
  });

  it("webbläsaren nekar → not-persisted (datan kan rensas)", async () => {
    expect(await ensurePersistentStorage(manager({ grant: false }))).toBe("not-persisted");
  });

  it("persist() kastar → not-persisted, ingen krasch", async () => {
    expect(await ensurePersistentStorage(manager({ throws: true }))).toBe("not-persisted");
  });

  it("inget StorageManager (gammal browser, osäker kontext) → unsupported", async () => {
    expect(await ensurePersistentStorage(undefined)).toBe("unsupported");
    expect(await ensurePersistentStorage({})).toBe("unsupported");
  });
});

describe("requestPersistentStorageOnce", () => {
  afterEach(() => {
    resetPersistentStorageRequestForTests();
    vi.unstubAllGlobals();
  });

  it("frågar bara EN gång per flik och delar svaret", async () => {
    const m = manager({ grant: true });
    vi.stubGlobal("navigator", { ...globalThis.navigator, storage: m });
    const [a, b] = await Promise.all([requestPersistentStorageOnce(), requestPersistentStorageOnce()]);
    expect(a).toBe("persisted");
    expect(b).toBe("persisted");
    expect(m.persist).toHaveBeenCalledTimes(1);
  });

  it("utan navigator (SSR) → unsupported", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await requestPersistentStorageOnce()).toBe("unsupported");
  });
});
