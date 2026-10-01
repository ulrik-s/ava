/**
 * `chunk-reload` (#1355) — en flik med ett äldre bygge än servern ber om chunks
 * som inte längre finns. Fliken laddas om en gång; kommer felet igen direkt
 * blir det ett besked i stället för en omladdningsloop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { isChunkLoadError, recoverFromChunkError, reloadOnce, watchChunkErrors } from "@/lib/client/pwa/chunk-reload";

function chunkError(): Error {
  const e = new Error("Failed to load chunk /_next/static/chunks/abc.js from module 123");
  e.name = "ChunkLoadError";
  return e;
}

describe("isChunkLoadError", () => {
  it("Turbopacks ChunkLoadError och webbläsarnas importfel", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 42 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk app failed"))).toBe(true);
  });

  it("vanliga fel och icke-fel är det inte", () => {
    expect(isChunkLoadError(new Error("Ärendet finns inte"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("reloadOnce", () => {
  function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  }

  it("första gången laddas fliken om; inom en minut inte igen; därefter igen", () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadOnce(storage, 1_000_000, reload)).toBe(true);
    expect(reloadOnce(storage, 1_030_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(storage, 1_061_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("recoverFromChunkError", () => {
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

  it("laddar om via flikens sessionStorage; direkt igen → besked (true), ingen ny omladdning", () => {
    const reload = vi.fn();
    expect(recoverFromChunkError(reload)).toBe(false);
    expect(recoverFromChunkError(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("sessionStorage otillgänglig (privat läge) → sidans minne: en omladdning, sedan besked", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new DOMException("blockerad", "SecurityError"); } });
    try {
      const reload = vi.fn();
      expect(recoverFromChunkError(reload)).toBe(false);
      expect(recoverFromChunkError(reload)).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
      else Reflect.deleteProperty(window, "sessionStorage");
    }
  });

  it("standard-omladdningen laddar om sidan", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      recoverFromChunkError();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});

describe("watchChunkErrors", () => {
  /** En fejk-`window` som samlar lyssnarna. */
  function target() {
    const listeners = new Map<string, (e: never) => void>();
    return {
      listeners,
      addEventListener: (type: string, cb: (e: never) => void) => { listeners.set(type, cb); },
      removeEventListener: (type: string, cb: (e: never) => void) => { if (listeners.get(type) === cb) listeners.delete(type); },
      fire: (type: string, event: object) => { listeners.get(type)?.(event as never); },
    };
  }

  it("ofångade chunk-fel och avvisade chunk-importer rapporteras; andra fel inte; avregistreringen tar bort lyssnarna", () => {
    const t = target();
    const onChunkError = vi.fn();
    const stop = watchChunkErrors(t, onChunkError);
    t.fire("error", { error: chunkError() });
    t.fire("unhandledrejection", { reason: new TypeError("Failed to fetch dynamically imported module: x") });
    t.fire("error", { error: new Error("annat") });
    t.fire("unhandledrejection", { reason: new Error("annat") });
    expect(onChunkError).toHaveBeenCalledTimes(2);
    stop();
    expect(t.listeners.size).toBe(0);
  });
});
