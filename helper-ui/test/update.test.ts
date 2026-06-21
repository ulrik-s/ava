import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import {
  assetName,
  checkOnce,
  downloadAndReplace,
  pickLatest,
  runUpdateLoop,
  type CheckDeps,
  type GithubRelease,
  type UpdateConfig,
} from "../src/engine/update.ts";
import { expectRejection } from "./helpers.ts";

interface Rel {
  tag_name: string;
  draft: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function rel(tag: string, draft = false): Rel {
  return { tag_name: tag, draft, assets: [] };
}

/** Release med binär-asset + (default) dess `.sig`-asset. */
function relWithAsset(tag: string, assetNameStr: string, url: string, withSig = true): GithubRelease {
  const assets = [{ name: assetNameStr, browser_download_url: url }];
  if (withSig) assets.push({ name: `${assetNameStr}.sig`, browser_download_url: `${url}.sig` });
  return { tag_name: tag, draft: false, assets };
}

describe("assetName", () => {
  test("os/arch-format utan ext på unix", () => {
    expect(assetName("darwin", "arm64")).toBe("ava-helper-darwin-arm64");
    expect(assetName("linux", "x64")).toBe("ava-helper-linux-x64");
  });
  test(".exe på windows", () => {
    expect(assetName("windows", "x64")).toBe("ava-helper-windows-x64.exe");
  });
});

describe("pickLatest", () => {
  test("väljer nyaste icke-draft som matchar filter + är nyare", () => {
    const releases = [
      rel("helper-v1.0.0"),
      rel("helper-v1.3.0"),
      rel("helper-v1.2.0"),
    ];
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

interface CheckHarness {
  cfg: UpdateConfig;
  deps: CheckDeps;
  replaced: Array<{ url: string; target: string; sigUrl: string }>;
  updated: string[];
}

function checkHarness(releases: GithubRelease[], asset = "ava-helper-test"): CheckHarness {
  const replaced: CheckHarness["replaced"] = [];
  const updated: string[] = [];
  return {
    replaced,
    updated,
    deps: {
      fetchReleases: async () => releases,
      replace: async (url, target, sigUrl) => { replaced.push({ url, target, sigUrl }); },
      targetPath: "/bin/ava-helper",
      asset,
    },
    cfg: {
      currentVersion: "helper-v1.0.0",
      repo: "o/r",
      tagFilter: "helper-",
      checkIntervalMs: 0,
      initialDelayMs: 0,
      onUpdated: (v) => updated.push(v),
    },
  };
}

describe("checkOnce", () => {
  test("ingen nyare release → varken replace eller onUpdated", async () => {
    const h = checkHarness([relWithAsset("helper-v1.0.0", "ava-helper-test", "http://x")]);
    await checkOnce(h.cfg, h.deps);
    expect(h.replaced).toHaveLength(0);
    expect(h.updated).toHaveLength(0);
  });

  test("nyare + matchande asset + signatur → replace(url,target,sigUrl) + onUpdated(tag)", async () => {
    const h = checkHarness([relWithAsset("helper-v1.5.0", "ava-helper-test", "http://dl/bin")]);
    await checkOnce(h.cfg, h.deps);
    expect(h.replaced).toEqual([{ url: "http://dl/bin", target: "/bin/ava-helper", sigUrl: "http://dl/bin.sig" }]);
    expect(h.updated).toEqual(["helper-v1.5.0"]);
  });

  test("nyare men inget matchande asset → ingen replace/onUpdated", async () => {
    const h = checkHarness([relWithAsset("helper-v1.5.0", "ava-helper-annat-os", "http://x")]);
    await checkOnce(h.cfg, h.deps);
    expect(h.replaced).toHaveLength(0);
    expect(h.updated).toHaveLength(0);
  });

  test("binär finns men signatur-asset saknas → vägrar (fail-closed)", async () => {
    const h = checkHarness([relWithAsset("helper-v1.5.0", "ava-helper-test", "http://dl/bin", false)]);
    await checkOnce(h.cfg, h.deps);
    expect(h.replaced).toHaveLength(0);
    expect(h.updated).toHaveLength(0);
  });
});

describe("runUpdateLoop", () => {
  test("kör check tills signalen abortas", async () => {
    const ctrl = new AbortController();
    let checks = 0;
    const cfg = checkHarness([]).cfg;
    await runUpdateLoop(cfg, ctrl.signal, {
      check: async () => { checks++; ctrl.abort(); },
      sleep: async () => undefined,
    });
    expect(checks).toBe(1);
  });

  test("fångar fel från check och fortsätter loopa", async () => {
    const ctrl = new AbortController();
    let n = 0;
    const cfg = checkHarness([]).cfg;
    await runUpdateLoop(cfg, ctrl.signal, {
      check: async () => {
        n++;
        if (n === 1) throw new Error("transient");
        ctrl.abort();
      },
      sleep: async () => undefined,
    });
    expect(n).toBe(2); // felet fångades → loopen körde check en gång till
  });
});

describe("downloadAndReplace (integration)", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const BINARY = "NY BINÄR v2";
  // Färskt test-nyckelpar; den publika nyckeln injiceras i downloadAndReplace.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const goodSig = sign(null, Buffer.from(BINARY), privateKey);

  /** Kopiera bytes till en färsk ArrayBuffer (entydig BodyInit för Response). */
  function toArrayBuffer(u: Uint8Array): ArrayBuffer {
    const ab = new ArrayBuffer(u.byteLength);
    new Uint8Array(ab).set(u);
    return ab;
  }

  /** Bun-server som serverar binären på /bin och signaturen på /bin.sig. */
  function serveBinaryAndSig(sig: Uint8Array) {
    return Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname.endsWith(".sig")
          ? new Response(toArrayBuffer(sig))
          : new Response(BINARY),
    });
  }

  test("verifierar signaturen, laddar ner + byter ut målet + sätter exec-bit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ava-upd-"));
    dirs.push(dir);
    const target = join(dir, "ava-helper");
    await writeFile(target, "GAMMAL BINÄR");
    await chmod(target, 0o644);

    const server = serveBinaryAndSig(goodSig);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      await downloadAndReplace(`${base}/bin`, target, `${base}/bin.sig`, [pubB64]);
      expect(await readFile(target, "utf8")).toBe(BINARY);
      const mode = (await stat(target)).mode & 0o777;
      expect(mode & 0o100).toBe(0o100); // owner-exec satt
    } finally {
      void server.stop(true);
    }
  });

  test("ogiltig signatur → kastar och behåller gamla binären (fail-closed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ava-upd-"));
    dirs.push(dir);
    const target = join(dir, "ava-helper");
    await writeFile(target, "GAMMAL BINÄR");

    const badSig = sign(null, Buffer.from(" fel innehåll "), privateKey);
    const server = serveBinaryAndSig(badSig);
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const err = await expectRejection(downloadAndReplace(`${base}/bin`, target, `${base}/bin.sig`, [pubB64]));
      expect(String(err)).toContain("matchar ingen pinnad release-nyckel");
      expect(await readFile(target, "utf8")).toBe("GAMMAL BINÄR"); // oförändrad
    } finally {
      void server.stop(true);
    }
  });

  test("HTTP-fel → kastar", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const err = await expectRejection(downloadAndReplace(`${base}/x`, "/tmp/whatever", `${base}/x.sig`, [pubB64]));
      expect(String(err)).toContain("download HTTP 500");
    } finally {
      void server.stop(true);
    }
  });
});
