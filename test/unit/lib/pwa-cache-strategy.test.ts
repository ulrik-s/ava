/**
 * Tester för PWA cache-strategi-helpers.
 *
 * Strategi-funktioner är rena funktioner som ger en strategi-id
 * baserat på request-URL. Service-worker:n importerar dem och kallar
 * dem för varje fetch-event.
 *
 * Vinster:
 *   - SW-koden i sw.ts blir liten + okomplicerad
 *   - Strategi-mapping kan testas utan riktig SW-runtime
 *   - DRY: kan återanvändas i en eventuell SSR-cache-warmup
 */

import { describe, it, expect } from "vitest";
import {
  cacheStrategyFor,
  shouldCacheResponse,
  type CacheStrategy,
} from "@/client/lib/pwa-cache-strategy";

describe("cacheStrategyFor", () => {
  it("statiska Next-bundles → cache-first (stabilt content-hash i URL)", () => {
    expect(cacheStrategyFor("/_next/static/chunks/main-abc.js")).toBe("cache-first");
    expect(cacheStrategyFor("/_next/static/css/styles-def.css")).toBe("cache-first");
  });

  it("manifest + ikoner → cache-first", () => {
    expect(cacheStrategyFor("/manifest.json")).toBe("cache-first");
    expect(cacheStrategyFor("/icons/icon-192.png")).toBe("cache-first");
  });

  it("HTML-pages → network-first med fallback (för fresh content)", () => {
    expect(cacheStrategyFor("/")).toBe("network-first");
    expect(cacheStrategyFor("/demo")).toBe("network-first");
    expect(cacheStrategyFor("/matters")).toBe("network-first");
  });

  it("/api/* → network-only (datafetch ska aldrig bli stale)", () => {
    expect(cacheStrategyFor("/api/trpc")).toBe("network-only");
    expect(cacheStrategyFor("/api/documents/upload")).toBe("network-only");
  });

  it("externa GitHub-anrop → network-only (men SW har redan released request)", () => {
    expect(cacheStrategyFor("https://github.com/x.git")).toBe("network-only");
  });
});

describe("shouldCacheResponse", () => {
  it("cachar 200-OK responses", () => {
    expect(shouldCacheResponse({ ok: true, status: 200, type: "basic" })).toBe(true);
  });

  it("cachar inte 4xx/5xx", () => {
    expect(shouldCacheResponse({ ok: false, status: 404, type: "basic" })).toBe(false);
    expect(shouldCacheResponse({ ok: false, status: 500, type: "basic" })).toBe(false);
  });

  it("cachar inte opaque cross-origin responses (kan vara fel)", () => {
    expect(shouldCacheResponse({ ok: true, status: 0, type: "opaque" })).toBe(false);
  });

  it("cachar 'basic' och 'default' types", () => {
    expect(shouldCacheResponse({ ok: true, status: 200, type: "default" })).toBe(true);
  });
});

describe("strategi-konstanter", () => {
  it("returnerar strategi-typer som täcker alla fall", () => {
    const all = ["cache-first", "network-first", "network-only", "stale-while-revalidate"] as const;
    for (const s of all) {
      const t: CacheStrategy = s;
      expect(t).toBe(s);
    }
  });
});
