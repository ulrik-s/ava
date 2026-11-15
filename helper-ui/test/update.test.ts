/**
 * Update-kontroll (ADR 0030 §2) — ENDAST notis: hitta en nyare release och
 * returnera version + release-sida. Ingen binär-self-replace längre (den
 * pensionerades med Electron-konsolideringen). Allt nät injicerat → testbart.
 */

import { describe, expect, test } from "bun:test";

import {
  checkForUpdate,
  createUpdateTracker,
  pickLatest,
  runUpdateLoop,
  type GithubRelease,
  type UpdateNotice,
} from "../src/engine/update.ts";

const ZIP = [{ name: "AVA-Helper-mac-arm64.zip" }];

function rel(tag: string, draft = false, url?: string, assets = ZIP): GithubRelease {
  return { tag_name: tag, draft, html_url: url ?? `https://github.com/o/r/releases/tag/${tag}`, assets };
}

describe("pickLatest", () => {
  test("väljer nyaste icke-draft som matchar filter + är nyare", () => {
    const releases = [rel("v1.0.0"), rel("v1.3.0"), rel("v1.2.0")];
    expect(pickLatest(releases, "v", "v1.0.0")?.tag_name).toBe("v1.3.0");
  });

  test("hoppar över drafts", () => {
    const releases = [rel("v2.0.0", true), rel("v1.1.0")];
    expect(pickLatest(releases, "v", "v1.0.0")?.tag_name).toBe("v1.1.0");
  });

  test("filtrerar bort taggar utan prefix", () => {
    const releases = [rel("web-9.0.0"), rel("v1.1.0")];
    expect(pickLatest(releases, "v", "v1.0.0")?.tag_name).toBe("v1.1.0");
  });

  test("release utan helper-zip (bygget pågår/föll) räknas inte", () => {
    const releases = [rel("v1.2.0", false, undefined, [{ name: "ava-web-demo_v1.2.0.zip" }]), rel("v1.1.0")];
    expect(pickLatest(releases, "v", "v1.0.0")?.tag_name).toBe("v1.1.0");
  });

  test("null när inget är nyare", () => {
    expect(pickLatest([rel("v1.0.0")], "v", "v1.2.0")).toBeNull();
  });
});

const CFG = { currentVersion: "v1.0.0", repo: "o/r", tagFilter: "v" };

describe("checkForUpdate", () => {
  test("nyare release → notis med version + release-sida", async () => {
    const notice = await checkForUpdate(CFG, {
      fetchReleases: () => Promise.resolve([rel("v1.5.0", false, "https://github.com/o/r/releases/tag/v1.5.0")]),
    });
    expect(notice).toEqual({ version: "v1.5.0", url: "https://github.com/o/r/releases/tag/v1.5.0" });
  });

  test("inget nyare → null", async () => {
    const notice = await checkForUpdate(CFG, { fetchReleases: () => Promise.resolve([rel("v1.0.0")]) });
    expect(notice).toBeNull();
  });

  test("fetch-fel propageras (trackern fångar det)", async () => {
    await expect(
      checkForUpdate(CFG, { fetchReleases: () => Promise.reject(new Error("GitHub HTTP 503")) }),
    ).rejects.toThrow("GitHub HTTP 503");
  });
});

const AT = new Date("2026-11-15T18:05:00");
const NOTICE: UpdateNotice = { version: "v2.0.0", url: "https://x" };

describe("createUpdateTracker", () => {
  test("ingen kontroll än → tom status", () => {
    expect(createUpdateTracker(() => Promise.resolve(null)).status()).toEqual({ checking: false, notice: null, last: null });
  });

  test("pågår → checking; klar → utfall + tid", async () => {
    let release: (n: UpdateNotice | null) => void = () => {};
    const t = createUpdateTracker(() => new Promise((r) => { release = r; }), () => AT);
    const done = t.check();
    expect(t.status().checking).toBe(true);
    release(NOTICE);
    expect(await done).toEqual({ checking: false, notice: NOTICE, last: { at: AT, result: "available" } });
  });

  test("senaste versionen → up-to-date", async () => {
    const t = createUpdateTracker(() => Promise.resolve(null), () => AT);
    expect((await t.check()).last).toEqual({ at: AT, result: "up-to-date" });
  });

  test("fel → error, kastar inte, behåller tidigare notis", async () => {
    let fail = false;
    const t = createUpdateTracker(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve(NOTICE)), () => AT);
    await t.check();
    fail = true;
    expect(await t.check()).toEqual({ checking: false, notice: NOTICE, last: { at: AT, result: "error" } });
  });

  test("samtidiga anrop delar på en kontroll", async () => {
    let calls = 0;
    const t = createUpdateTracker(() => { calls++; return Promise.resolve(null); });
    await Promise.all([t.check(), t.check()]);
    await t.check();
    expect(calls).toBe(2);
  });
});

describe("runUpdateLoop", () => {
  test("sover initialt, kollar och sover tills signalen abortas", async () => {
    const ctrl = new AbortController();
    const sleeps: number[] = [];
    let checks = 0;
    await runUpdateLoop(
      { checkIntervalMs: 2, initialDelayMs: 1 },
      () => { if (++checks === 2) ctrl.abort(); return Promise.resolve(); },
      ctrl.signal,
      (ms) => { sleeps.push(ms); return Promise.resolve(); },
    );
    expect(checks).toBe(2);
    expect(sleeps).toEqual([1, 2, 2]);
  });

  test("default-sleep avbryts av signalen", async () => {
    const ctrl = new AbortController();
    const loop = runUpdateLoop({ checkIntervalMs: 60_000, initialDelayMs: 60_000 }, () => Promise.resolve(), ctrl.signal);
    ctrl.abort();
    await loop; // löses direkt trots 60 s fördröjning
  });
});
