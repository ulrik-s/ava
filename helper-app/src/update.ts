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

import { chmod, rename } from "node:fs/promises";

import { log } from "./log.ts";
import { currentPlatform, type Platform } from "./platform/runtime.ts";
import { isNewer } from "./semver.ts";

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

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  draft: boolean;
  assets: GithubAsset[];
}

/** Asset-namn CI laddar upp per plattform, t.ex. `ava-helper-darwin-arm64`. */
export function assetName(platform: Platform = currentPlatform(), arch: string = process.arch): string {
  const ext = platform === "windows" ? ".exe" : "";
  return `ava-helper-${platform}-${arch}${ext}`;
}

/** Loopa för evigt: kolla, sov. Anropas som bakgrunds-task. */
export async function runUpdateLoop(cfg: UpdateConfig, signal: AbortSignal): Promise<void> {
  await sleep(cfg.initialDelayMs, signal);
  while (!signal.aborted) {
    try {
      await checkOnce(cfg);
    } catch (err) {
      log(`update check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(cfg.checkIntervalMs, signal);
  }
}

/** En synkron kontroll. Returnerar utan att kasta om allt är OK. */
export async function checkOnce(cfg: UpdateConfig): Promise<void> {
  const releases = await fetchReleases(cfg.repo);
  const latest = pickLatest(releases, cfg.tagFilter, cfg.currentVersion);
  if (latest === null) {
    log(`already up to date (${cfg.currentVersion})`);
    return;
  }
  const asset = latest.assets.find((a) => a.name === assetName());
  if (asset === undefined) {
    log(`no asset ${assetName()} in ${latest.tag_name}`);
    return;
  }
  log(`updating ${cfg.currentVersion} → ${latest.tag_name}`);
  await downloadAndReplace(asset.browser_download_url, process.execPath);
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

/**
 * Ladda ner binären till en temp-fil bredvid målet, gör den körbar och
 * byt ut den löpande binären. På unix funkar rename-over direkt; på
 * Windows flyttas den gamla undan först (kan inte skrivas över medan den
 * körs).
 */
async function downloadAndReplace(url: string, targetPath: string): Promise<void> {
  const tmpPath = `${targetPath}.new`;
  const resp = await fetch(url);
  if (resp.status >= 400) throw new Error(`download HTTP ${resp.status}`);
  await Bun.write(tmpPath, resp);
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
