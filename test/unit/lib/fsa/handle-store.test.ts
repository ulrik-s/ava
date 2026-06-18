/**
 * Tester för handle-store: permission-handling + FSA/OPFS-detektering +
 * getOpfsRoot + IndexedDB-persistensen (saveHandle/loadHandle/deleteHandle)
 * mot fake-indexeddb (happy-dom saknar IndexedDB → vi stoppar in en IDBFactory
 * som global `indexedDB`; --isolate håller mutationen i denna fil).
 */

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";

describe("ensureReadWrite", () => {
  it("OPFS-handle (saknar query/requestPermission) → alltid granted", async () => {
    const { ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
    expect(await ensureReadWrite({ name: "opfs" } as unknown as FileSystemDirectoryHandle)).toBe(true);
  });

  it("queryPermission='granted' → true utan request", async () => {
    const requestPermission = vi.fn();
    const handle = {
      queryPermission: vi.fn(async () => "granted" as PermissionState),
      requestPermission,
    } as unknown as FileSystemDirectoryHandle;
    const { ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
    expect(await ensureReadWrite(handle)).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("queryPermission='prompt' → request, returnerar dess result (granted)", async () => {
    const handle = {
      queryPermission: vi.fn(async () => "prompt" as PermissionState),
      requestPermission: vi.fn(async () => "granted" as PermissionState),
    } as unknown as FileSystemDirectoryHandle;
    const { ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
    expect(await ensureReadWrite(handle)).toBe(true);
  });

  it("requestPermission='denied' → false", async () => {
    const handle = {
      queryPermission: vi.fn(async () => "prompt" as PermissionState),
      requestPermission: vi.fn(async () => "denied" as PermissionState),
    } as unknown as FileSystemDirectoryHandle;
    const { ensureReadWrite } = await import("@/lib/client/fsa/handle-store");
    expect(await ensureReadWrite(handle)).toBe(false);
  });
});

describe("isFsaSupported / isOpfsSupported", () => {
  afterEach(() => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it("isFsaSupported = true när showDirectoryPicker finns", async () => {
    (globalThis as { showDirectoryPicker?: unknown; window?: unknown }).showDirectoryPicker = () => {};
    // @ts-expect-error — window stub
    globalThis.window = globalThis;
    const { isFsaSupported } = await import("@/lib/client/fsa/handle-store");
    expect(isFsaSupported()).toBe(true);
  });

  it("isOpfsSupported = true när navigator.storage.getDirectory finns", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { getDirectory: async () => ({}) },
      configurable: true,
    });
    const { isOpfsSupported } = await import("@/lib/client/fsa/handle-store");
    expect(isOpfsSupported()).toBe(true);
  });
});

describe("getOpfsRoot", () => {
  it("returnerar null om OPFS saknas", async () => {
    Object.defineProperty(globalThis.navigator, "storage", { value: {}, configurable: true });
    const { getOpfsRoot } = await import("@/lib/client/fsa/handle-store");
    expect(await getOpfsRoot()).toBeNull();
  });

  it("returnerar root utan subdir", async () => {
    const fakeRoot = { name: "opfs-root" };
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { getDirectory: async () => fakeRoot },
      configurable: true,
    });
    const { getOpfsRoot } = await import("@/lib/client/fsa/handle-store");
    expect(await getOpfsRoot()).toBe(fakeRoot);
  });

  it("returnerar subdir när subdir-arg angiven", async () => {
    const subdirHandle = { name: "working-copy" };
    const fakeRoot = {
      name: "opfs-root",
      getDirectoryHandle: vi.fn(async (name: string, opts: { create: boolean }) => {
        expect(name).toBe("working-copy");
        expect(opts.create).toBe(true);
        return subdirHandle;
      }),
    };
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { getDirectory: async () => fakeRoot },
      configurable: true,
    });
    const { getOpfsRoot } = await import("@/lib/client/fsa/handle-store");
    expect(await getOpfsRoot("working-copy")).toBe(subdirHandle);
  });
});

describe("IndexedDB-persistens (saveHandle / loadHandle / deleteHandle)", () => {
  let prevIndexedDb: PropertyDescriptor | undefined;

  beforeEach(() => {
    prevIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    // Färsk in-memory-IDB per test → ingen läckning mellan testfall.
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (prevIndexedDb) Object.defineProperty(globalThis, "indexedDB", prevIndexedDb);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  // FSA-handles serialiseras via structured clone i IndexedDB; en vanlig
  // plain-object-stub räcker som fixtur (fake-indexeddb klonar den).
  const fakeHandle = (name: string) =>
    ({ name, kind: "directory" }) as unknown as FileSystemDirectoryHandle;

  it("loadHandle på okänd nyckel → null", async () => {
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    expect(await loadHandle("repo-root")).toBeNull();
  });

  it("saveHandle → loadHandle round-trippar handle:n (per nyckel)", async () => {
    const { saveHandle, loadHandle } = await import("@/lib/client/fsa/handle-store");
    await saveHandle("repo-root", fakeHandle("wc"));
    const loaded = await loadHandle("repo-root");
    expect(loaded).toMatchObject({ name: "wc", kind: "directory" });
    // Annan nyckel är orörd.
    expect(await loadHandle("other")).toBeNull();
  });

  it("saveHandle skriver över samma nyckel", async () => {
    const { saveHandle, loadHandle } = await import("@/lib/client/fsa/handle-store");
    await saveHandle("k", fakeHandle("first"));
    await saveHandle("k", fakeHandle("second"));
    expect(await loadHandle("k")).toMatchObject({ name: "second" });
  });

  it("deleteHandle tömmer nyckeln → loadHandle null igen", async () => {
    const { saveHandle, loadHandle, deleteHandle } = await import("@/lib/client/fsa/handle-store");
    await saveHandle("k", fakeHandle("wc"));
    expect(await loadHandle("k")).not.toBeNull();
    await deleteHandle("k");
    expect(await loadHandle("k")).toBeNull();
  });

  it("loadHandle utan IndexedDB i miljön → null (SSR/privat flik-fallback)", async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    expect(await loadHandle("repo-root")).toBeNull();
  });
});
