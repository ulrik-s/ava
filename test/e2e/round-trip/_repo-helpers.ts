/**
 * Hjälpare för git-round-trip-e2e: klona/läs bare-repo:t på docker-servern
 * så testen kan verifiera att UI-skrivningar faktiskt landade i git-db:n.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const GIT_URL = process.env.AVA_RT_GIT_URL ?? "http://localhost:8080/git/firma.git";

/**
 * Bygger auth-prefix:en `admin:PAT@` från `AVA_RT_GIT_PAT` (om satt).
 * Web-containern bootstrap:ar en slumpad admin-PAT vid första uppstart
 * och printar den i loggen. Hämta den med:
 *   docker logs ava-web-1 2>&1 | grep "Admin-token"
 * och exportera AVA_RT_GIT_PAT=<pat> innan yarn round-trip.
 */
function urlWithAuth(url: string): string {
  const pat = process.env.AVA_RT_GIT_PAT;
  if (!pat) return url;
  return url.replace(/^(https?:\/\/)/, `$1admin:${encodeURIComponent(pat)}@`);
}

/** Klona repo:t till en temp-mapp och returnera sökvägen. */
export function freshClone(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ava-rt-"));
  execFileSync("git", ["clone", "-q", urlWithAuth(GIT_URL), dir], { stdio: "pipe" });
  return dir;
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Lista .json-filer under en under-mapp i den klonade working copy:n. */
export function listJson(dir: string, sub: string): string[] {
  const p = path.join(dir, sub);
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((f) => f.endsWith(".json"));
}

/** Läs + parsa alla .json-rader under en under-mapp. */
export function readAll(dir: string, sub: string): Array<Record<string, unknown>> {
  return listJson(dir, sub).map((f) => JSON.parse(readFileSync(path.join(dir, sub, f), "utf8")));
}

/**
 * Nollställ bare-repo:t till EN ren commit (bara .gitkeep) — testisolering
 * så tidigare körningars data inte läcker in i assertions. Force-push.
 * Repo:t är icke-tomt (en commit) så app-clonen funkar.
 */
export function resetRepo(): void {
  const dir = freshClone();
  try {
    for (const e of readdirSync(dir)) {
      if (e === ".git") continue;
      rmSync(path.join(dir, e), { recursive: true, force: true });
    }
    writeFileSync(path.join(dir, ".gitkeep"), "");
    const run = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=seed@ava.local", "-c", "user.name=seed", ...args], { cwd: dir, stdio: "pipe" });
    run("add", "-A");
    // --allow-empty: om föregående test slutade i samma rena tillstånd som vi
    // försöker återställa till (bara .gitkeep) finns inget att committa, vilket
    // annars dödar processen med "nothing to commit".
    run("commit", "-q", "--allow-empty", "-m", "reset");
    // Push måste också ha auth — annars 401 från nginx. Sätt remote-URL
    // till auth-prefix:ad variant och push:a mot main.
    run("remote", "set-url", "origin", urlWithAuth(GIT_URL));
    run("push", "-q", "--force", "origin", "HEAD:main");
  } finally {
    cleanup(dir);
  }
}
