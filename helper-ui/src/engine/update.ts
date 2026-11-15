/**
 * Update-kontroll — daglig koll mot GitHub releases. **Endast notis:** hittar en
 * nyare release och returnerar dess version + release-sida. Electron-skalet
 * visar "Ny version finns — ladda ner" i menyraden; användaren installerar
 * manuellt (osignerat bygge → ingen tyst auto-update, ADR 0030 §2).
 *
 * Den gamla binär-self-replacen (download + Ed25519-verifiering + atomiskt byte
 * av `process.execPath`) är **pensionerad** i och med konsolideringen till en
 * Electron-app: appen kan inte ersätta sig själv osignerad, och det levereras
 * ingen fristående binär längre.
 *
 * Tagging: helpern byggs till varje release (`v*`-taggen, helper-release.yml)
 * och bär taggen som version. En release räknas först när helper-zippen är
 * uppladdad (bygget tar några minuter efter att releasen skapats).
 */

import { log } from "./log.ts";
import { isNewer } from "./semver.ts";

export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  /** Release-sidan på GitHub — öppnas när användaren väljer "ladda ner". */
  html_url: string;
  assets: ReadonlyArray<{ name: string }>;
}

/** Helper-zippen som helper-release.yml laddar upp (`AVA-Helper-mac-<arch>.zip`). */
const HELPER_ASSET_PREFIX = "AVA-Helper-";

/** En nyare release som hittats — version + release-sida att öppna. */
export interface UpdateNotice {
  version: string;
  url: string;
}

export interface UpdateCheckConfig {
  currentVersion: string;
  /** "owner/name" på GitHub. */
  repo: string;
  /** Bara taggar med detta prefix beaktas (t.ex. "v"). Tom = alla. */
  tagFilter: string;
}

/** Injicerbar fetch → testbar utan nät. */
export interface CheckDeps {
  fetchReleases: (repo: string) => Promise<GithubRelease[]>;
}

function defaultCheckDeps(): CheckDeps {
  return { fetchReleases };
}

/** En kontroll: finns en nyare release? Returnerar notisen, annars null. */
export async function checkForUpdate(
  cfg: UpdateCheckConfig,
  deps: CheckDeps = defaultCheckDeps(),
): Promise<UpdateNotice | null> {
  const releases = await deps.fetchReleases(cfg.repo);
  const latest = pickLatest(releases, cfg.tagFilter, cfg.currentVersion);
  if (latest === null) {
    log(`already up to date (${cfg.currentVersion})`);
    return null;
  }
  log(`update available: ${cfg.currentVersion} → ${latest.tag_name}`);
  return { version: latest.tag_name, url: latest.html_url };
}

async function fetchReleases(repo: string): Promise<GithubRelease[]> {
  const resp = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ava-helper" },
  });
  if (resp.status >= 400) throw new Error(`GitHub HTTP ${resp.status}`);
  return (await resp.json()) as GithubRelease[];
}

/** Välj nyaste icke-draft-release med helper-zip vars tagg matchar filter + är nyare. */
export function pickLatest(
  releases: readonly GithubRelease[],
  tagFilter: string,
  currentVersion: string,
): GithubRelease | null {
  let best: GithubRelease | null = null;
  for (const rel of releases) {
    if (!isCandidate(rel, tagFilter, currentVersion)) continue;
    if (best === null || isNewer(rel.tag_name, best.tag_name)) best = rel;
  }
  return best;
}

/** Publicerad, har helper-zip, matchar filtret och är nyare än nuvarande. */
function isCandidate(rel: GithubRelease, tagFilter: string, currentVersion: string): boolean {
  if (rel.draft || !rel.assets.some((a) => a.name.startsWith(HELPER_ASSET_PREFIX))) return false;
  return rel.tag_name.startsWith(tagFilter) && isNewer(rel.tag_name, currentVersion);
}

/** Utfallet av senaste kontrollen. */
export type UpdateResult = "up-to-date" | "available" | "error";

/** Vad skalet visar: pågår en kontroll, senaste utfall och ev. notis. */
export interface UpdateStatus {
  checking: boolean;
  notice: UpdateNotice | null;
  last: { at: Date; result: UpdateResult } | null;
}

export interface UpdateTracker {
  status: () => UpdateStatus;
  /** Kör en kontroll — samtidiga anrop delar på samma. Kastar aldrig. */
  check: () => Promise<UpdateStatus>;
}

/** Senaste kontrollens status, delad av bakgrundsloopen och menyvalet. */
export function createUpdateTracker(
  check: () => Promise<UpdateNotice | null>,
  now: () => Date = () => new Date(),
): UpdateTracker {
  let status: UpdateStatus = { checking: false, notice: null, last: null };
  let inflight: Promise<UpdateStatus> | null = null;
  const run = async (): Promise<UpdateStatus> => {
    status = { ...status, checking: true };
    try {
      const notice = await check();
      status = { checking: false, notice, last: { at: now(), result: notice ? "available" : "up-to-date" } };
    } catch (err) {
      log(`update check failed: ${err instanceof Error ? err.message : String(err)}`);
      status = { ...status, checking: false, last: { at: now(), result: "error" } };
    }
    return status;
  };
  return {
    status: () => status,
    check: () => (inflight ??= run().finally(() => { inflight = null; })),
  };
}

export interface LoopConfig {
  checkIntervalMs: number;
  initialDelayMs: number;
}

/** Loopa: sov, kolla, sov … tills signalen abortas. `check` får inte kasta. */
export async function runUpdateLoop(
  cfg: LoopConfig,
  check: () => Promise<unknown>,
  signal: AbortSignal,
  sleepFn: (ms: number, signal: AbortSignal) => Promise<void> = sleep,
): Promise<void> {
  await sleepFn(cfg.initialDelayMs, signal);
  while (!signal.aborted) {
    await check();
    await sleepFn(cfg.checkIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
