#!/usr/bin/env bun
/**
 * SHA-pinna GitHub Actions (#910) — supply-chain-härdning.
 *
 * En rörlig tagg (`@v7`) kan flyttas av action-ägaren till annan kod utan att
 * något syns i vårt repo. Pinning till full commit-SHA gör byggen
 * reproducerbara och gör en kompromitterad action synlig som en diff:
 *
 *     uses: actions/checkout@v7
 *     uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v7
 *
 * Versionen behålls som kommentar, så Dependabot (`github-actions`-ekosystemet,
 * `.github/dependabot.yml`) kan bumpa SHA:n och kommentaren tillsammans.
 *
 * Skriptet är BÅDE pinnare och bumpare: körs det igen slås taggen i kommentaren
 * upp på nytt och SHA:n uppdateras. Kör det efter en action-uppgradering.
 *
 *     bun run pin:actions            # pinna/bumpa på plats
 *     bun run pin:actions --check    # fäll om något är opinnat (CI-läge)
 *     bun run pin:actions --dry-run  # visa vad som skulle ändras
 *
 * Uppslaget görs via `gh api repos/<owner>/<repo>/commits/<ref>` när GitHub CLI
 * finns inloggad, annars via `git ls-remote` — vilket fungerar överallt där git
 * når github.com (t.ex. bakom en git-proxy där GitHub-API:et är blockerat).
 */

import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Kataloger som innehåller `uses:`-referenser. */
const SOURCE_DIRS = [".github/workflows", ".github/actions"] as const;

/** En `uses:`-referens i en workflow-fil. */
export interface ActionRef {
  /** Hela raden, som den står i filen. */
  line: string;
  /** `owner/repo` — det som slås upp mot API:et (utan ev. underkatalog). */
  repo: string;
  /** Underkatalog för monorepo-actions (`github/codeql-action/init` → `/init`). */
  subpath: string;
  /** Nuvarande ref: en tagg (`v7`) eller en redan pinnad SHA. */
  ref: string;
  /** Versionskommentaren efter SHA:n, om raden redan är pinnad. */
  comment: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;

/** Är ref:en redan en full commit-SHA? */
export function isSha(ref: string): boolean {
  return SHA_RE.test(ref);
}

/**
 * Tolka en `uses:`-rad. Returnerar null för rader som inte ska pinnas:
 *   - lokala actions (`./.github/actions/bun-setup`) — de är vår egen kod
 *   - docker-actions (`docker://…`) — pinnas med digest, annat format
 *   - reusable workflows i samma repo (`./.github/workflows/x.yml`)
 */
export function parseUsesLine(line: string): ActionRef | null {
  const m = /^(\s*-?\s*uses:\s*)([^\s#]+)(?:\s*#\s*(.*))?$/.exec(line);
  if (!m) return null;
  const target = m[2] ?? "";
  if (isLocalOrDocker(target)) return null;
  const [path, ref] = splitRef(target);
  if (!ref) return null;
  const parts = path.split("/");
  if (parts.length < 2) return null;
  return {
    line,
    repo: `${parts[0]}/${parts[1]}`,
    subpath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "",
    ref,
    comment: (m[3] ?? "").trim(),
  };
}

/** Lokal action (vår egen kod) eller docker-action (annat pin-format) → hoppas över. */
function isLocalOrDocker(target: string): boolean {
  return target.startsWith("./") || target.startsWith("docker://");
}

/** `owner/repo@ref` → `[owner/repo, ref]`. Saknad `@` ger tom ref. */
function splitRef(target: string): [string, string] {
  const at = target.lastIndexOf("@");
  if (at < 0) return [target, ""];
  return [target.slice(0, at), target.slice(at + 1)];
}

/**
 * Taggen som ska slås upp för en referens. En opinnad rad slås upp på sin ref;
 * en redan pinnad rad slås upp på VERSIONSKOMMENTAREN, så skriptet kan bumpa
 * SHA:n när taggen flyttats. Pinnad rad utan kommentar lämnas orörd (vi vet
 * inte vilken version den avser och får inte gissa).
 */
export function lookupTag(ref: ActionRef): string | null {
  if (!isSha(ref.ref)) return ref.ref;
  return ref.comment || null;
}

/** Alla pinnbara referenser i en fil. */
export function actionRefsIn(text: string): ActionRef[] {
  return text.split("\n").map(parseUsesLine).filter((r): r is ActionRef => r !== null);
}

/**
 * Skriv om filens `uses:`-rader till `owner/repo[/sub]@<sha> # <tagg>`.
 * `resolved` mappar `owner/repo@tagg` → SHA. Referenser som saknas i mappen
 * lämnas orörda (uppslaget misslyckades — hellre oförändrad än fel SHA).
 */
export function applyPins(text: string, resolved: ReadonlyMap<string, string>): string {
  return text.split("\n").map((line) => {
    const ref = parseUsesLine(line);
    const tag = ref && lookupTag(ref);
    if (!ref || !tag) return line;
    const sha = resolved.get(`${ref.repo}@${tag}`);
    if (!sha) return line;
    const prefix = /^(\s*-?\s*uses:\s*)/.exec(line)?.[1] ?? "";
    return `${prefix}${ref.repo}${ref.subpath}@${sha} # ${tag}`;
  }).join("\n");
}

/**
 * Plocka commit-SHA:n ur `git ls-remote`-utdata för en tagg.
 *
 * En ANNOTERAD tagg är ett eget objekt: `refs/tags/v3` pekar på tagg-objektet
 * och `refs/tags/v3^{}` på commiten. Vi måste ta den PEELADE raden — annars
 * pinnas actionen till ett tagg-objekt, vilket inte är en commit.
 * En lightweight-tagg saknar `^{}`-rad och pekar direkt på commiten.
 */
export function shaFromLsRemote(stdout: string, tag: string): string | null {
  let plain: string | null = null;
  for (const line of stdout.split("\n")) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref || !isSha(sha)) continue;
    if (ref === `refs/tags/${tag}^{}`) return sha; // peelad commit vinner alltid
    if (ref === `refs/tags/${tag}`) plain = sha;
  }
  return plain;
}

/** Referenser som ännu inte är SHA-pinnade — `--check` fäller på dessa. */
export function unpinned(refs: readonly ActionRef[]): ActionRef[] {
  return refs.filter((r) => !isSha(r.ref));
}

// ── I/O-skal ────────────────────────────────────────────────────────────────

/** Alla workflow-/action-YAML-filer, rekursivt. */
async function sourceFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of SOURCE_DIRS) out.push(...await yamlFilesIn(dir));
  return out.sort();
}

async function yamlFilesIn(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // katalogen finns inte i alla checkouts
  }
  const out: string[] = [];
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...await yamlFilesIn(path));
    else if (/\.ya?ml$/.test(e.name)) out.push(path);
  }
  return out;
}

const GH_PROBE_URL = "https://github.com/actions/checkout";

/** Finns GitHub CLI inloggad? Styr vilken uppslagsväg som används. */
function hasGh(): boolean {
  return spawnSync("gh", ["auth", "status"], { encoding: "utf8" }).status === 0;
}

/** Kan git nå github.com? Fallbacken när `gh` saknas. */
function hasGitRemoteAccess(): boolean {
  return spawnSync("git", ["ls-remote", GH_PROBE_URL, "HEAD"], { encoding: "utf8" }).status === 0;
}

/**
 * NÅGON uppslagsväg måste finnas innan vi rör en enda fil, annars blir felet
 * obegripligt mitt i körningen.
 */
function assertLookupAvailable(useGh: boolean): void {
  if (useGh || hasGitRemoteAccess()) return;
  throw new Error(
    "hittade ingen väg att slå upp taggar.\n"
    + "  Antingen `gh` inloggad (`gh auth login`) eller git-åtkomst till github.com krävs.",
  );
}

/** Slå upp en tagg → commit-SHA. Null när uppslaget misslyckas — ett enskilt
 *  fallerat uppslag får inte fälla hela körningen. */
function resolveSha(repo: string, tag: string, useGh: boolean): string | null {
  return useGh ? shaViaGh(repo, tag) : shaViaGit(repo, tag);
}

function shaViaGh(repo: string, tag: string): string | null {
  const res = spawnSync("gh", ["api", `repos/${repo}/commits/${tag}`, "--jq", ".sha"], { encoding: "utf8" });
  const sha = (res.stdout ?? "").trim();
  return res.status === 0 && isSha(sha) ? sha : null;
}

function shaViaGit(repo: string, tag: string): string | null {
  const res = spawnSync(
    "git", ["ls-remote", "--tags", `https://github.com/${repo}`, tag, `${tag}^{}`],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return null;
  return shaFromLsRemote(res.stdout ?? "", tag);
}

/** Alla unika `repo@tagg`-par att slå upp, i stabil ordning. */
function lookupTargets(refs: readonly ActionRef[]): Array<{ repo: string; tag: string }> {
  const seen = new Map<string, { repo: string; tag: string }>();
  for (const ref of refs) {
    const tag = lookupTag(ref);
    if (tag) seen.set(`${ref.repo}@${tag}`, { repo: ref.repo, tag });
  }
  return [...seen.values()];
}

interface Options { check: boolean; dryRun: boolean }

/** `--check`: rapportera opinnade referenser och fäll. Skriver inget. */
async function runCheck(files: readonly string[]): Promise<void> {
  const bad: string[] = [];
  for (const file of files) {
    for (const ref of unpinned(actionRefsIn(await readFile(file, "utf8")))) {
      bad.push(`  ${file}: ${ref.repo}${ref.subpath}@${ref.ref}`);
    }
  }
  if (bad.length === 0) {
    process.stdout.write("pin:actions: alla actions är SHA-pinnade ✓\n");
    return;
  }
  process.stderr.write(`pin:actions: ${bad.length} opinnade actions:\n${bad.join("\n")}\n`);
  process.stderr.write("Kör `bun run pin:actions` för att pinna dem.\n");
  process.exitCode = 1;
}

/** Slå upp alla taggar en gång och returnera `repo@tagg` → SHA. */
async function resolveAll(files: readonly string[], useGh: boolean): Promise<Map<string, string>> {
  const refs: ActionRef[] = [];
  for (const file of files) refs.push(...actionRefsIn(await readFile(file, "utf8")));
  const resolved = new Map<string, string>();
  for (const { repo, tag } of lookupTargets(refs)) {
    const sha = resolveSha(repo, tag, useGh);
    if (sha) resolved.set(`${repo}@${tag}`, sha);
    else process.stderr.write(`pin:actions: kunde inte slå upp ${repo}@${tag} — lämnas orörd\n`);
  }
  return resolved;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const opts: Options = { check: args.has("--check"), dryRun: args.has("--dry-run") };
  const files = await sourceFiles();
  if (files.length === 0) {
    process.stderr.write("pin:actions: hittade inga workflow-filer\n");
    process.exitCode = 1;
    return;
  }
  if (opts.check) return runCheck(files);

  const useGh = hasGh();
  assertLookupAvailable(useGh);
  process.stdout.write(`pin:actions: slår upp taggar via ${useGh ? "gh api" : "git ls-remote"}\n`);
  const resolved = await resolveAll(files, useGh);
  let changed = 0;
  for (const file of files) {
    const before = await readFile(file, "utf8");
    const after = applyPins(before, resolved);
    if (after === before) continue;
    changed++;
    if (opts.dryRun) process.stdout.write(`pin:actions: skulle ändra ${file}\n`);
    else await writeFile(file, after, "utf8");
  }
  const verb = opts.dryRun ? "skulle ändras" : "uppdaterade";
  process.stdout.write(`pin:actions: ${changed} av ${files.length} filer ${verb}\n`);
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`pin:actions: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
