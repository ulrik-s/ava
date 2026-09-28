/**
 * `sw-routing` (#1240) — vilken strategi service workern väljer per förfrågan.
 *
 * Reglerna är en ALLOWLIST: bara app-skalet (sidor, RSC-payloads, `_next/static`,
 * favicon) får cachas. Allt annat — tRPC, git, inloggning, demo-data — ska gå
 * rakt till nätet, annars kan en cachad dataförfrågan servera gammal data eller
 * en annan användares svar.
 */
import { describe, expect, it } from "vitest-compat";
import {
  appRelativePath,
  offlineFallbackPath,
  routeRequest,
  scopeBasePath,
  withoutSearch,
} from "@/lib/client/pwa/sw-routing";

const ORIGIN = "https://ava-crm.io";
const ROOT = { origin: ORIGIN, basePath: "" };
const DEMO = { origin: "https://ulrik-s.github.io", basePath: "/ava" };

function get(url: string, mode = "cors"): { url: string; method: string; mode: string } {
  return { url, method: "GET", mode };
}

describe("scopeBasePath", () => {
  it("rot-scope → tom bas", () => {
    expect(scopeBasePath("https://ava-crm.io/")).toBe("");
  });
  it("under-sökväg → utan avslutande snedstreck", () => {
    expect(scopeBasePath("https://ulrik-s.github.io/ava/")).toBe("/ava");
  });
});

describe("appRelativePath", () => {
  it("strippar basen", () => {
    expect(appRelativePath(new URL("https://ulrik-s.github.io/ava/matters/"), DEMO)).toBe("/matters/");
  });
  it("själva basen utan snedstreck → rot", () => {
    expect(appRelativePath(new URL("https://ulrik-s.github.io/ava"), DEMO)).toBe("/");
  });
  it("annan origin → null", () => {
    expect(appRelativePath(new URL("https://evil.example/ava/"), DEMO)).toBeNull();
  });
  it("utanför basen → null (t.ex. /avatar på samma origin)", () => {
    expect(appRelativePath(new URL("https://ulrik-s.github.io/avatar/"), DEMO)).toBeNull();
    expect(appRelativePath(new URL("https://ulrik-s.github.io/other/"), DEMO)).toBeNull();
  });
  it("rot-bas → hela sökvägen", () => {
    expect(appRelativePath(new URL("https://ava-crm.io/matters/x/"), ROOT)).toBe("/matters/x/");
  });
});

describe("routeRequest — positiva fall (app-skalet)", () => {
  it("_next/static → cache-first", () => {
    expect(routeRequest(get(`${ORIGIN}/_next/static/chunks/a1.js`), ROOT)).toBe("cache-first");
    expect(routeRequest(get("https://ulrik-s.github.io/ava/_next/static/media/f.woff2"), DEMO)).toBe("cache-first");
  });
  it("favicon → cache-first", () => {
    expect(routeRequest(get(`${ORIGIN}/favicon.ico`), ROOT)).toBe("cache-first");
  });
  it("navigering → network-first", () => {
    expect(routeRequest(get(`${ORIGIN}/matters/`, "navigate"), ROOT)).toBe("network-first");
    expect(routeRequest(get(`${ORIGIN}/`, "navigate"), ROOT)).toBe("network-first");
  });
  it("RSC-payload (index.txt / __next.*.txt) → network-first", () => {
    expect(routeRequest(get(`${ORIGIN}/matters/index.txt?_rsc=abc`), ROOT)).toBe("network-first");
    expect(routeRequest(get(`${ORIGIN}/matters/__next.matters.__PAGE__.txt`), ROOT)).toBe("network-first");
  });
});

describe("routeRequest — negativa fall (får ALDRIG cachas)", () => {
  it("icke-GET → bypass", () => {
    expect(routeRequest({ url: `${ORIGIN}/_next/static/a.js`, method: "POST", mode: "cors" }, ROOT)).toBe("bypass");
  });
  it("tRPC/API → bypass även som navigering", () => {
    expect(routeRequest(get(`${ORIGIN}/api/trpc/matter.list?batch=1`), ROOT)).toBe("bypass");
    expect(routeRequest(get(`${ORIGIN}/api/trpc/x`, "navigate"), ROOT)).toBe("bypass");
  });
  it("git, oauth2 och hälsokontroller → bypass", () => {
    for (const p of ["/git/firma.git/info/refs", "/oauth2/start", "/healthz", "/readyz"]) {
      expect(routeRequest(get(`${ORIGIN}${p}`, "navigate"), ROOT)).toBe("bypass");
    }
  });
  it("demo-data (seed, manifest, .ava, dokument-bytes) → bypass", () => {
    for (const p of ["/demo-seed.json", "/manifest.json", "/.ava/meta.json", "/documents/content/x.pdf", "/matters/abc.json"]) {
      expect(routeRequest(get(`https://ulrik-s.github.io/ava${p}`), DEMO)).toBe("bypass");
    }
  });
  it("själva sw.js → bypass (uppdateringskollen måste nå nätet)", () => {
    expect(routeRequest(get(`${ORIGIN}/sw.js`), ROOT)).toBe("bypass");
  });
  it("andra .txt-filer än RSC-payloads → bypass", () => {
    expect(routeRequest(get(`${ORIGIN}/robots.txt`), ROOT)).toBe("bypass");
  });
  it("annan origin → bypass", () => {
    expect(routeRequest(get("https://cdn.example/_next/static/a.js"), ROOT)).toBe("bypass");
    expect(routeRequest(get("http://127.0.0.1:48761/health"), ROOT)).toBe("bypass");
  });
  it("utanför scope → bypass", () => {
    expect(routeRequest(get("https://ulrik-s.github.io/other/", "navigate"), DEMO)).toBe("bypass");
  });
  it("ogiltig URL → bypass", () => {
    expect(routeRequest(get("not a url"), ROOT)).toBe("bypass");
  });
});

describe("offlineFallbackPath", () => {
  it("runtime-id under en shell-route → __shell__-sentinellen", () => {
    expect(offlineFallbackPath("/matters/0190a1b2-0000-7000-8000-000000000001/")).toBe("/matters/__shell__/");
    expect(offlineFallbackPath("/invoices/abc")).toBe("/invoices/__shell__/");
  });
  it("mallredigering behåller /edit", () => {
    expect(offlineFallbackPath("/templates/abc/edit/")).toBe("/templates/__shell__/edit/");
  });
  it("okänd sida → roten (som try_files /index.html)", () => {
    expect(offlineFallbackPath("/nagot/okant/")).toBe("/");
    expect(offlineFallbackPath("/documents/abc/")).toBe("/");
  });
});

describe("withoutSearch", () => {
  it("tar bort query och hash", () => {
    expect(withoutSearch("https://a.b/matters/index.txt?_rsc=1#x")).toBe("https://a.b/matters/index.txt");
  });
});
