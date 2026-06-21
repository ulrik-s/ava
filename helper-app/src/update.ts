/**
 * Self-update — daglig kontroll mot GitHub releases + atomisk ersättning
 * av egen binär. Port av Go:s update-paket (som använde go-selfupdate);
 * här en tunn fetch-baserad implementation utan extern dep.
 *
 * Tagging: helper-releaser taggas "helper-vX.Y.Z" (separat från web-app).
 * CI laddar upp en binär per plattform med namn `ava-helper-<os>-<arch>`.
 *
 * Restart-policy: efter lyckad uppdatering anropas `onUpdated`, som
 * förväntas avsluta processen (exit 0) → service-runnern (launchd/systemd/
 * Task Scheduler) startar om med nya bytsen.
 */

import { chmod, rename, writeFile } from "node:fs/promises";

import { log } from "./log.ts";
import { currentPlatform, type Platform } from "./platform/runtime.ts";
import { isNewer } from "./semver.ts";
import { acceptedPublicKeys, assertSignature, signatureAssetName } from "./update-verify.ts";

export interface UpdateConfig {
  currentVersion: string;
  /** "owner/name" på GitHub. */
  repo: string;
  /** Bara taggar med detta prefix beaktas (t.ex. "helper-"). Tom = alla. */
  tagFilter: string;
  checkIntervalMs: number;
  initialDelayMs: number;
  /** Anropas när ny binär skrivits; förväntas avsluta processen. */
  onUpdated: (newVersion: string) => void;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
}
export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  assets: GithubAsset[];
}

/** Asset-namn CI laddar upp per plattform, t.ex. `ava-helper-darwin-arm64`. */
export function assetName(platform: Platform = currentPlatform(), arch: string = process.arch): string {
  const ext = platform === "windows" ? ".exe" : "";
  return `ava-helper-${platform}-${arch}${ext}`;
}

/** Injicerbara IO-beroenden för loopen (SOLID) → testbar utan tid/nät. */
export interface LoopDeps {
  check: (cfg: UpdateConfig) => Promise<void>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultLoopDeps: LoopDeps = { check: (cfg) => checkOnce(cfg), sleep };

/** Loopa för evigt: kolla, sov. Anropas som bakgrunds-task. */
export async function runUpdateLoop(
  cfg: UpdateConfig,
  signal: AbortSignal,
  deps: LoopDeps = defaultLoopDeps,
): Promise<void> {
  await deps.sleep(cfg.initialDelayMs, signal);
  while (!signal.aborted) {
    try {
      await deps.check(cfg);
    } catch (err) {
      log(`update check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await deps.sleep(cfg.checkIntervalMs, signal);
  }
}

/** Injicerbara beroenden för en kontroll → testbar utan nät/fs. */
export interface CheckDeps {
  fetchReleases: (repo: string) => Promise<GithubRelease[]>;
  /** Verifiera signaturen (`sigUrl`) över binären (`url`) → byt bara vid match. */
  replace: (url: string, targetPath: string, sigUrl: string) => Promise<void>;
  targetPath: string;
  asset: string;
}

function defaultCheckDeps(): CheckDeps {
  return { fetchReleases, replace: downloadAndReplace, targetPath: process.execPath, asset: assetName() };
}

/** En synkron kontroll. Returnerar utan att kasta om allt är OK. */
export async function checkOnce(cfg: UpdateConfig, deps: CheckDeps = defaultCheckDeps()): Promise<void> {
  const releases = await deps.fetchReleases(cfg.repo);
  const latest = pickLatest(releases, cfg.tagFilter, cfg.currentVersion);
  if (latest === null) {
    log(`already up to date (${cfg.currentVersion})`);
    return;
  }
  const asset = latest.assets.find((a) => a.name === deps.asset);
  if (asset === undefined) {
    log(`no asset ${deps.asset} in ${latest.tag_name}`);
    return;
  }
  // Äkthetskrav (#110): en detached signatur MÅSTE finnas + verifieras innan
  // byte. Saknas .sig-asseten → vägra (fail-closed), behåll gamla binären.
  const sig = latest.assets.find((a) => a.name === signatureAssetName(deps.asset));
  if (sig === undefined) {
    log(`no signature ${signatureAssetName(deps.asset)} in ${latest.tag_name} — refusing update`);
    return;
  }
  log(`updating ${cfg.currentVersion} → ${latest.tag_name}`);
  await deps.replace(asset.browser_download_url, deps.targetPath, sig.browser_download_url);
  cfg.onUpdated(latest.tag_name);
}

async function fetchReleases(repo: string): Promise<GithubRelease[]> {
  const resp = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ava-helper" },
  });
  if (resp.status >= 400) throw new Error(`GitHub HTTP ${resp.status}`);
  return (await resp.json()) as GithubRelease[];
}

/** Välj nyaste icke-draft-release vars tagg matchar filter + är nyare. */
export function pickLatest(
  releases: readonly GithubRelease[],
  tagFilter: string,
  currentVersion: string,
): GithubRelease | null {
  let best: GithubRelease | null = null;
  for (const rel of releases) {
    if (rel.draft) continue;
    if (tagFilter !== "" && !rel.tag_name.startsWith(tagFilter)) continue;
    if (!isNewer(rel.tag_name, currentVersion)) continue;
    if (best === null || isNewer(rel.tag_name, best.tag_name)) best = rel;
  }
  return best;
}

/** Hämta bytes från en URL (delad av binär- + signatur-nedladdning). */
async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  const resp = await fetch(url);
  if (resp.status >= 400) throw new Error(`${what} HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

/**
 * Ladda ner binären + dess detached signatur, **verifiera signaturen mot den
 * pinnade release-nyckeln** (#110) och byt först därefter ut den löpande
 * binären. Ingen match → kasta, behåll gamla binären (fail-closed).
 *
 * På unix funkar rename-over direkt; på Windows flyttas den gamla undan först
 * (kan inte skrivas över medan den körs).
 */
export async function downloadAndReplace(
  url: string,
  targetPath: string,
  sigUrl: string,
  keys: readonly string[] = acceptedPublicKeys(),
): Promise<void> {
  const bytes = await fetchBytes(url, "download");
  const signature = await fetchBytes(sigUrl, "signature download");
  assertSignature(bytes, signature, keys); // kastar om osignerad/ej matchande

  const tmpPath = `${targetPath}.new`;
  await writeFile(tmpPath, bytes);
  await chmod(tmpPath, 0o755);
  if (currentPlatform() === "windows") {
    await rename(targetPath, `${targetPath}.old`).catch(() => undefined);
  }
  await rename(tmpPath, targetPath);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
