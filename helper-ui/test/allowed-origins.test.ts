import { describe, expect, test } from "bun:test";

import {
  isApprovableOrigin, isApprovedServerUrl, loadAllowedOrigins, OriginGate, tokenOnlyToApprovedServers, type OriginFileDeps,
} from "../src/engine/allowed-origins.ts";

/** In-memory "filsystem" för allowed-origins.json. */
function memFs(initial?: string): { deps: OriginFileDeps; files: Map<string, string> } {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set("/data/allowed-origins.json", initial);
  return {
    files,
    deps: {
      readText: (p) => { const t = files.get(p); if (t === undefined) throw new Error("ENOENT"); return t; },
      mkdirp: () => {},
      writeText: (p, t) => { files.set(p, t); },
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("isApprovableOrigin", () => {
  test("bara rena https-origins", () => {
    expect(isApprovableOrigin("https://ava-crm.io")).toBe(true);
    expect(isApprovableOrigin("http://ava-crm.io")).toBe(false); // http kan avlyssnas
    expect(isApprovableOrigin("https://ava-crm.io/path")).toBe(false); // inte en origin
    expect(isApprovableOrigin("null")).toBe(false);
    expect(isApprovableOrigin("")).toBe(false);
  });
});

describe("loadAllowedOrigins", () => {
  test("läser filen och filtrerar bort ogiltiga poster", () => {
    const { deps } = memFs(JSON.stringify(["https://ava-crm.io", "http://evil", 42]));
    expect(loadAllowedOrigins("/data", deps)).toEqual(["https://ava-crm.io"]);
  });

  test("saknad/trasig fil eller ingen data-dir → []", () => {
    expect(loadAllowedOrigins("/data", memFs().deps)).toEqual([]);
    expect(loadAllowedOrigins("/data", memFs("{inte json").deps)).toEqual([]);
    expect(loadAllowedOrigins(null, memFs().deps)).toEqual([]);
  });
});

describe("OriginGate (trust-on-first-use)", () => {
  test("Tillåt → origin släpps in och sparas", async () => {
    const { deps, files } = memFs();
    const gate = new OriginGate("/data", async () => true, deps);
    gate.onUnknown("https://ava-crm.io");
    await flush();
    expect(gate.list()).toEqual(["https://ava-crm.io"]);
    expect(JSON.parse(files.get("/data/allowed-origins.json")!)).toEqual(["https://ava-crm.io"]);
    // Överlever omstart.
    expect(new OriginGate("/data", undefined, deps).list()).toEqual(["https://ava-crm.io"]);
  });

  test("Neka → inte godkänd, inget sparat", async () => {
    const { deps, files } = memFs();
    const gate = new OriginGate("/data", async () => false, deps);
    gate.onUnknown("https://evil.example");
    await flush();
    expect(gate.list()).toEqual([]);
    expect(files.size).toBe(0);
  });

  test("frågar högst en gång per origin och session (pollande sida)", async () => {
    const asked: string[] = [];
    const gate = new OriginGate("/data", async (o) => { asked.push(o); return false; }, memFs().deps);
    gate.onUnknown("https://ava-crm.io");
    gate.onUnknown("https://ava-crm.io");
    await flush();
    expect(asked).toEqual(["https://ava-crm.io"]);
  });

  test("frågar aldrig om http-origins eller utan dialog (headless)", async () => {
    const asked: string[] = [];
    new OriginGate("/data", async (o) => { asked.push(o); return true; }, memFs().deps).onUnknown("http://ava-crm.io");
    new OriginGate("/data", undefined, memFs().deps).onUnknown("https://ava-crm.io");
    await flush();
    expect(asked).toEqual([]);
  });

  test("utan data-dir: godkänd i minnet men inget skrivs", async () => {
    const { deps, files } = memFs();
    const gate = new OriginGate(null, async () => true, deps);
    gate.onUnknown("https://ava-crm.io");
    await flush();
    expect(gate.list()).toEqual(["https://ava-crm.io"]);
    expect(files.size).toBe(0);
  });
});

describe("isApprovedServerUrl (#1838)", () => {
  const approved = ["https://ava.example"];

  test("localhost-porten och en godkänd https-server godtas", () => {
    expect(isApprovedServerUrl("http://localhost:8080/api/trpc", approved)).toBe(true);
    expect(isApprovedServerUrl("https://ava.example/api/trpc", approved)).toBe(true);
  });

  test("en annan värd, ett värdsuffix, användarnamn i URL:en, en annan port och en ogiltig URL godtas inte", () => {
    expect(isApprovedServerUrl("https://annan.example/api/trpc", approved)).toBe(false);
    expect(isApprovedServerUrl("https://ava.example.annan.example/", approved)).toBe(false);
    expect(isApprovedServerUrl("http://localhost:8080@annan.example/", approved)).toBe(false);
    expect(isApprovedServerUrl("https://ava.example:8443/api/trpc", approved)).toBe(false);
    expect(isApprovedServerUrl("inte en url", approved)).toBe(false);
    expect(isApprovedServerUrl("", approved)).toBe(false);
  });
});

describe("tokenOnlyToApprovedServers (#1838)", () => {
  function counting(): { token: () => Promise<string | undefined>; calls: () => number } {
    let n = 0;
    return { token: () => { n += 1; return Promise.resolve("Bearer TOK"); }, calls: () => n };
  }

  test("godkänd värd → token", async () => {
    const src = counting();
    const auth = tokenOnlyToApprovedServers(src.token, () => []);
    expect(await auth("http://localhost:8080/api/trpc")).toBe("Bearer TOK");
    expect(src.calls()).toBe(1);
  });

  test("annan värd → undefined, och token-källan anropas inte", async () => {
    const src = counting();
    const auth = tokenOnlyToApprovedServers(src.token, () => []);
    expect(await auth("https://annan.example/api/trpc")).toBeUndefined();
    expect(await auth("inte en url")).toBeUndefined();
    expect(src.calls()).toBe(0);
  });

  test("en origin som godkänns efteråt får token direkt (listan läses vid varje anrop)", async () => {
    const src = counting();
    const list: string[] = [];
    const auth = tokenOnlyToApprovedServers(src.token, () => list);
    expect(await auth("https://ava-crm.io/api/trpc")).toBeUndefined();
    list.push("https://ava-crm.io");
    expect(await auth("https://ava-crm.io/api/trpc")).toBe("Bearer TOK");
  });
});
