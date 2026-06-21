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
 * Tagging: helper-releaser taggas "helper-vX.Y.Z" (separat från web-app).
 */

import { log } from "./log.ts";
import { isNewer } from "./semver.ts";

export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  /** Release-sidan på GitHub — öppnas när användaren väljer "ladda ner". */
  html_url: string;
}

/** En nyare release som hittats — version + release-sida att öppna. */
export interface UpdateNotice {
  version: string;
  url: string;
}

export interface UpdateCheckConfig {
  currentVersion: string;
  /** "owner/name" på GitHub. */
  repo: string;
  /** Bara taggar med detta prefix beaktas (t.ex. "helper-"). Tom = alla. */
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

export interface NoticeLoopConfig extends UpdateCheckConfig {
  checkIntervalMs: number;
  initialDelayMs: number;
  /** Anropas efter varje kontroll med resultatet (notis eller null). */
  onNotice: (notice: UpdateNotice | null) => void;
}

/** Injicerbara IO-beroenden för loopen (SOLID) → testbar utan tid/nät. */
export interface LoopDeps {
  check: (cfg: UpdateCheckConfig) => Promise<UpdateNotice | null>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultLoopDeps: LoopDeps = { check: (cfg) => checkForUpdate(cfg), sleep };

/** Loopa: sov, kolla, rapportera notis via `onNotice`. Anropas som bakgrunds-task. */
export async function runUpdateLoop(
  cfg: NoticeLoopConfig,
  signal: AbortSignal,
  deps: LoopDeps = defaultLoopDeps,
): Promise<void> {
  await deps.sleep(cfg.initialDelayMs, signal);
  while (!signal.aborted) {
    try {
      cfg.onNotice(await deps.check(cfg));
    } catch (err) {
      log(`update check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await deps.sleep(cfg.checkIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
