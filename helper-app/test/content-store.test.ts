/**
 * ContentStore (ADR 0028 §3, ADR 0023) — durabelt content-adresserat
 * dokument-lager. Testar mot riktig temp-katalog (durabiliteten ÄR poängen)
 * med injicerad klocka för deterministisk lastUsedAt/vräkning.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { ContentStore, DEFAULT_CACHE_TTL_DAYS, resolveCacheTtlMs, sha256Hex, type ContentStoreDeps } from "../src/content-store.ts";

const dirs: string[] = [];
async function tmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "ava-content-"));
  dirs.push(d);
  return d;
}
afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function clockDeps(start = 1_000): { deps: ContentStoreDeps; set: (t: number) => void } {
  let t = start;
  return { deps: { now: () => t }, set: (v) => { t = v; } };
}

const URL1 = "https://s/api/documents/1/download";
const URL2 = "https://s/api/documents/2/download";

describe("ContentStore.store + load", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("cachar bytes och hämtar dem igen (offline-reopen)", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    const data = bytes("PDF-innehåll");
    const hash = await store.store(URL1, data, "avtal.pdf");

    expect(hash).toBe(sha256Hex(data));
    const loaded = await store.load(URL1);
    expect(loaded).not.toBeNull();
    expect(new TextDecoder().decode(loaded!)).toBe("PDF-innehåll");
  });

  test("blob namnges efter sin hash + index.json skrivs", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    const data = bytes("x");
    const hash = await store.store(URL1, data, "a.pdf");
    expect((await readdir(join(dir, "blobs")))).toEqual([`${hash}.bin`]);
    expect((await readdir(dir))).toContain("index.json");
  });

  test("dedup: samma bytes under två nycklar → en blob", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    await store.store(URL1, bytes("samma"), "a.pdf");
    await store.store(URL2, bytes("samma"), "b.pdf");
    expect((await readdir(join(dir, "blobs")))).toHaveLength(1);
    expect(await store.has(URL1)).toBe(true);
    expect(await store.has(URL2)).toBe(true);
  });

  test("ny version på samma nyckel → ny blob, nyckeln pekar om", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    await store.store(URL1, bytes("v1"), "a.pdf");
    await store.store(URL1, bytes("v2"), "a.pdf");
    expect(new TextDecoder().decode((await store.load(URL1))!)).toBe("v2");
  });

  test("load på okänd nyckel → null", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    expect(await store.load("https://s/saknas")).toBeNull();
  });

  test("has speglar närvaro", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    expect(await store.has(URL1)).toBe(false);
    await store.store(URL1, bytes("x"), "a.pdf");
    expect(await store.has(URL1)).toBe(true);
  });

  test("load bumpar lastUsedAt", async () => {
    const clock = clockDeps(1_000);
    const store = new ContentStore(dir, clock.deps);
    await store.store(URL1, bytes("x"), "a.pdf");
    clock.set(5_000);
    await store.load(URL1);
    // En ny store-instans läser samma index från disk → lastUsedAt persisterat.
    const reloaded = new ContentStore(dir, clockDeps(9_999).deps);
    // 9_999 - 4_999 < cutoff → överlever; men 9_999 - 0 (om ej bumpat) hade vräkts.
    expect(await reloaded.evictUnusedOlderThan(6_000)).toBe(0);
  });
});

describe("ContentStore — durabilitet över omstart", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("ny instans läser cachade bytes (helper-omstart)", async () => {
    await new ContentStore(dir, clockDeps().deps).store(URL1, bytes("kvar"), "a.pdf");
    const fresh = new ContentStore(dir, clockDeps().deps);
    expect(new TextDecoder().decode((await fresh.load(URL1))!)).toBe("kvar");
  });

  test("borttappad blob → index-posten städas, load ger null", async () => {
    const store = new ContentStore(dir, clockDeps().deps);
    const hash = await store.store(URL1, bytes("x"), "a.pdf");
    await rm(join(dir, "blobs", `${hash}.bin`), { force: true });
    expect(await store.load(URL1)).toBeNull();
    expect(await store.has(URL1)).toBe(false); // städat
  });

  test("trasigt index → behandlas som tomt (ingen krasch)", async () => {
    await Bun.write(join(dir, "index.json"), "{ not json");
    const store = new ContentStore(dir, clockDeps().deps);
    expect(await store.load(URL1)).toBeNull();
  });
});

describe("ContentStore.evictUnusedOlderThan (ADR 0028 §7)", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("vräker poster äldre än maxAge, behåller färska", async () => {
    const clock = clockDeps(0);
    const store = new ContentStore(dir, clock.deps);
    await store.store(URL1, bytes("gammal"), "old.pdf"); // lastUsedAt 0
    clock.set(100);
    await store.store(URL2, bytes("ny"), "new.pdf"); // lastUsedAt 100

    clock.set(1_000);
    const evicted = await store.evictUnusedOlderThan(950); // cutoff 50 → URL1 (0) vräks, URL2 (100) kvar
    expect(evicted).toBe(1);
    expect(await store.has(URL1)).toBe(false);
    expect(await store.has(URL2)).toBe(true);
    expect((await readdir(join(dir, "blobs")))).toHaveLength(1); // gammal blob borttagen
  });

  test("delad blob raderas inte medan en kvarvarande nyckel pekar på den", async () => {
    const clock = clockDeps(0);
    const store = new ContentStore(dir, clock.deps);
    await store.store(URL1, bytes("delad"), "a.pdf"); // lastUsedAt 0
    clock.set(100);
    await store.store(URL2, bytes("delad"), "b.pdf"); // samma bytes, lastUsedAt 100

    clock.set(1_000);
    await store.evictUnusedOlderThan(950); // URL1 vräks, URL2 kvar
    expect((await readdir(join(dir, "blobs")))).toHaveLength(1); // blob lever (URL2 pekar)
    expect(new TextDecoder().decode((await store.load(URL2))!)).toBe("delad");
  });

  test("inget att vräka → 0", async () => {
    const store = new ContentStore(dir, clockDeps(0).deps);
    await store.store(URL1, bytes("x"), "a.pdf");
    expect(await store.evictUnusedOlderThan(1_000_000)).toBe(0);
  });
});

describe("resolveCacheTtlMs", () => {
  const DAY = 24 * 60 * 60_000;
  test("default 30 dagar när env saknas/ogiltig", () => {
    expect(resolveCacheTtlMs(undefined)).toBe(DEFAULT_CACHE_TTL_DAYS * DAY);
    expect(resolveCacheTtlMs("")).toBe(DEFAULT_CACHE_TTL_DAYS * DAY);
    expect(resolveCacheTtlMs("inte-ett-tal")).toBe(DEFAULT_CACHE_TTL_DAYS * DAY);
    expect(resolveCacheTtlMs("0")).toBe(DEFAULT_CACHE_TTL_DAYS * DAY); // 0/negativt → default
    expect(resolveCacheTtlMs("-5")).toBe(DEFAULT_CACHE_TTL_DAYS * DAY);
  });
  test("konfigurerbart antal dagar", () => {
    expect(resolveCacheTtlMs("7")).toBe(7 * DAY);
    expect(resolveCacheTtlMs("90")).toBe(90 * DAY);
  });
});

describe("ContentStore.startEvictionLoop", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("vräker gamla poster direkt vid start + tills signalen avbryts", async () => {
    const clock = clockDeps(0);
    const store = new ContentStore(dir, clock.deps);
    await store.store(URL1, bytes("gammal"), "a.pdf"); // lastUsedAt 0
    clock.set(10_000);
    const ctrl = new AbortController();
    store.startEvictionLoop(ctrl.signal, 5_000, 5); // ttl 5_000 → URL1 (0) vräks vid första tick
    // Poll tills vräkt (robust mot lastad CI-runner) i st.f. fast väntan.
    for (let i = 0; i < 100 && (await store.has(URL1)); i++) await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    expect(await store.has(URL1)).toBe(false);
  });

  test("avbruten signal innan tick → ingen vräkning", async () => {
    const clock = clockDeps(0);
    const store = new ContentStore(dir, clock.deps);
    await store.store(URL1, bytes("x"), "a.pdf");
    clock.set(10_000);
    const ctrl = new AbortController();
    ctrl.abort();
    store.startEvictionLoop(ctrl.signal, 5_000, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.has(URL1)).toBe(true); // orörd
  });
});

describe("sha256Hex", () => {
  test("deterministisk + skiljer på olika bytes", () => {
    expect(sha256Hex(bytes("a"))).toBe(sha256Hex(bytes("a")));
    expect(sha256Hex(bytes("a"))).not.toBe(sha256Hex(bytes("b")));
  });
});
