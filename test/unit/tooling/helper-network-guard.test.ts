/**
 * Enhetstesternas nätverksvakt mot AVA Helper (#1368): ingen test får nå den
 * riktiga helpern på utvecklarens dator (den öppnar dokument och Mail.app).
 */
import { describe, expect, it } from "bun:test";

import { HELPER_BASE, HELPER_HTTPS_BASE } from "@/lib/shared/helper/protocol";
import {
  assertNoHelperTraffic,
  guardFetch,
  HelperNetworkError,
  isHelperUrl,
  requestUrl,
} from "../../setup/helper-network-guard";
import { helperTraffic } from "../../setup/preload";

const okFetch = Object.assign(
  async (): Promise<Response> => new Response("ok"),
  { preconnect: (): void => {} },
);

describe("isHelperUrl", () => {
  it.each([
    `${HELPER_BASE}/ping`,
    `${HELPER_HTTPS_BASE}/compose-mail`,
    "http://localhost:48761/open",
    "http://[::1]:48762/ping",
  ])("spärrar helper-porten på loopback: %s", (url) => {
    expect(isHelperUrl(url)).toBe(true);
  });

  it.each([
    "http://127.0.0.1:9/ping",
    "http://localhost:3000/api/trpc",
    "http://example.com:48761/ping",
    "/relative/path",
  ])("släpper igenom annat: %s", (url) => {
    expect(isHelperUrl(url)).toBe(false);
  });
});

describe("requestUrl", () => {
  it("läser sträng, URL och Request", () => {
    expect(requestUrl("http://a.test/x")).toBe("http://a.test/x");
    expect(requestUrl(new URL("http://a.test/y"))).toBe("http://a.test/y");
    expect(requestUrl(new Request("http://a.test/z"))).toBe("http://a.test/z");
  });
});

describe("guardFetch", () => {
  it("avvisar helper-anrop och noterar URL:en", async () => {
    const seen: string[] = [];
    const guarded = guardFetch(okFetch, seen);
    await expect(guarded(`${HELPER_BASE}/compose-mail`)).rejects.toBeInstanceOf(HelperNetworkError);
    expect(seen).toEqual([`${HELPER_BASE}/compose-mail`]);
  });

  it("skickar annan trafik vidare till den riktiga fetch", async () => {
    const seen: string[] = [];
    const res = await guardFetch(okFetch, seen)("http://localhost:3000/x");
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual([]);
  });

  it("behåller fetch.preconnect", () => {
    expect(guardFetch(okFetch, []).preconnect).toBe(okFetch.preconnect);
  });
});

describe("assertNoHelperTraffic", () => {
  it("är tyst utan helper-trafik", () => {
    expect(() => assertNoHelperTraffic([])).not.toThrow();
  });

  it("kastar med URL:erna och tömmer listan", () => {
    const seen = [`${HELPER_BASE}/ping`];
    expect(() => assertNoHelperTraffic(seen)).toThrow(/riktiga AVA Helper: http:\/\/127\.0\.0\.1:48761\/ping/);
    expect(seen).toEqual([]);
  });
});

describe("preloaden", () => {
  it("har installerat vakten på den globala fetch", async () => {
    await expect(fetch(`${HELPER_BASE}/ping`)).rejects.toBeInstanceOf(HelperNetworkError);
    expect(helperTraffic).toEqual([`${HELPER_BASE}/ping`]);
    helperTraffic.length = 0; // annars fäller preloadens afterEach detta test
  });
});
