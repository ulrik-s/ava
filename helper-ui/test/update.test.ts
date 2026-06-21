/**
 * Update-kontroll (ADR 0030 §2) — ENDAST notis: hitta en nyare release och
 * returnera version + release-sida. Ingen binär-self-replace längre (den
 * pensionerades med Electron-konsolideringen). Allt nät injicerat → testbart.
 */

import { describe, expect, test } from "bun:test";

import {
  checkForUpdate,
  pickLatest,
  runUpdateLoop,
  type GithubRelease,
  type NoticeLoopConfig,
  type UpdateNotice,
} from "../src/engine/update.ts";

function rel(tag: string, draft = false, url?: string): GithubRelease {
  return { tag_name: tag, draft, html_url: url ?? `https://github.com/o/r/releases/tag/${tag}` };
}

describe("pickLatest", () => {
  test("väljer nyaste icke-draft som matchar filter + är nyare", () => {
    const releases = [rel("helper-v1.0.0"), rel("helper-v1.3.0"), rel("helper-v1.2.0")];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.3.0");
  });

  test("hoppar över drafts", () => {
    const releases = [rel("helper-v2.0.0", true), rel("helper-v1.1.0")];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.1.0");
  });

  test("filtrerar bort taggar utan prefix (web-app-releaser)", () => {
    const releases = [rel("web-v9.0.0"), rel("helper-v1.1.0")];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.1.0");
  });

  test("null när inget är nyare", () => {
    expect(pickLatest([rel("helper-v1.0.0")], "helper-", "helper-v1.2.0")).toBeNull();
  });
});

const CFG = { currentVersion: "helper-v1.0.0", repo: "o/r", tagFilter: "helper-" };

describe("checkForUpdate", () => {
  test("nyare release → notis med version + release-sida", async () => {
    const notice = await checkForUpdate(CFG, {
      fetchReleases: async () => [rel("helper-v1.5.0", false, "https://github.com/o/r/releases/tag/helper-v1.5.0")],
    });
    expect(notice).toEqual({ version: "helper-v1.5.0", url: "https://github.com/o/r/releases/tag/helper-v1.5.0" });
  });

  test("inget nyare → null", async () => {
    const notice = await checkForUpdate(CFG, { fetchReleases: async () => [rel("helper-v1.0.0")] });
    expect(notice).toBeNull();
  });

  test("fetch-fel propageras (loopen fångar det)", async () => {
    await expect(
      checkForUpdate(CFG, { fetchReleases: async () => { throw new Error("GitHub HTTP 503"); } }),
    ).rejects.toThrow("GitHub HTTP 503");
  });
});

function loopCfg(onNotice: (n: UpdateNotice | null) => void): NoticeLoopConfig {
  return { ...CFG, checkIntervalMs: 0, initialDelayMs: 0, onNotice };
}

describe("runUpdateLoop", () => {
  test("rapporterar notisen via onNotice tills signalen abortas", async () => {
    const ctrl = new AbortController();
    const seen: Array<UpdateNotice | null> = [];
    const notice: UpdateNotice = { version: "helper-v2.0.0", url: "https://x" };
    await runUpdateLoop(loopCfg((n) => seen.push(n)), ctrl.signal, {
      check: async () => { ctrl.abort(); return notice; },
      sleep: async () => undefined,
    });
    expect(seen).toEqual([notice]);
  });

  test("fångar fel från check och fortsätter loopa", async () => {
    const ctrl = new AbortController();
    let n = 0;
    await runUpdateLoop(loopCfg(() => {}), ctrl.signal, {
      check: async () => {
        n++;
        if (n === 1) throw new Error("transient");
        ctrl.abort();
        return null;
      },
      sleep: async () => undefined,
    });
    expect(n).toBe(2); // felet fångades → loopen körde check en gång till
  });
});
