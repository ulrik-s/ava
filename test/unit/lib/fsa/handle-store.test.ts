/**
 * Tester för handle-store: permission-handling + FSA/OPFS-detektering +
 * getOpfsRoot. IndexedDB-paths (saveHandle/loadHandle/deleteHandle) testas
 * inte i unit-suiten — de kräver en full IDB-implementation (fake-indexeddb
 * eller jsdom-fork). Täcks via e2e/round-trip-suiten istället.
 */

import { afterEach, describe, expect, it, vi } from "vitest-compat";

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
