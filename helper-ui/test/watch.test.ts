import { describe, expect, test } from "bun:test";

import type { UploadTarget } from "../src/engine/document-source.ts";
import { runWatch, type WatchDeps } from "../src/engine/open.ts";
import { fakeClock } from "./helpers.ts";

interface Harness {
  deps: WatchDeps;
  uploads: Array<{ path: string; target: UploadTarget; auth: string | undefined }>;
}

const URL_TARGET: UploadTarget = { uploadUrl: "http://up" };

/**
 * Bygg deterministiska watch-deps: `mtimes` matas ut i tur och ordning
 * (initial stat först), klockan rör sig `stepMs` per sleep. `failUpload`
 * gör att varje upload kastar.
 */
function harness(mtimes: Array<number | null>, stepMs: number, failUpload = false): Harness {
  const clock = fakeClock(1000);
  const uploads: Harness["uploads"] = [];
  let i = 0;
  const deps: WatchDeps = {
    statMtime: async () => (i < mtimes.length ? mtimes[i++]! : mtimes[mtimes.length - 1]!),
    upload: async (path, target, auth) => {
      uploads.push({ path, target, auth });
      if (failUpload) throw new Error("upload boom");
    },
    sleep: async () => clock.advance(stepMs),
    now: clock.now,
  };
  return { deps, uploads };
}

describe("runWatch", () => {
  test("ingen ändring → ingen upload, stannar vid timeout", async () => {
    const h = harness([100, 100, 100, 100], 500);
    await runWatch("/f", URL_TARGET, undefined, 1000, h.deps);
    expect(h.uploads).toHaveLength(0);
  });

  test("upptäckt ändring → laddar upp en gång + förlänger deadline", async () => {
    // initial 100, oförändrad, sedan 200 (save). timeout 1500, steg 500.
    const h = harness([100, 100, 200, 200, 200, 200, 200, 200], 500);
    await runWatch("/doc.pdf", URL_TARGET, "Bearer x", 1500, h.deps);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toEqual({ path: "/doc.pdf", target: URL_TARGET, auth: "Bearer x" });
  });

  test("två separata sparningar → två uploads", async () => {
    const h = harness([100, 200, 300, 300, 300, 300], 400);
    await runWatch("/f", URL_TARGET, undefined, 2000, h.deps);
    expect(h.uploads).toHaveLength(2);
  });

  test("upload-fel kraschar inte loopen", async () => {
    const h = harness([100, 200, 200, 200], 500, true);
    await runWatch("/f", URL_TARGET, undefined, 1000, h.deps);
    expect(h.uploads.length).toBeGreaterThanOrEqual(1); // försökte, fångade felet
  });

  test("filen borta vid start (mtime 0) → returnerar utan watch", async () => {
    const h = harness([null], 500);
    await runWatch("/gone", URL_TARGET, undefined, 1000, h.deps);
    expect(h.uploads).toHaveLength(0);
  });
});
