/**
 * AVA:s version och datum vid bygget (#1578). `next.config.ts` lägger dem i
 * `NEXT_PUBLIC_AVA_VERSION` / `NEXT_PUBLIC_AVA_VERSION_DATE`, så att de bakas
 * in i klienten, på samma sätt som `NEXT_PUBLIC_DEMO_BASE_PATH`.
 *
 *   - versionen = `git describe --tags` (`v0.7.11`, `v0.7.11-3-gabc1234`),
 *   - datumet = commit-datumet för `HEAD` (ISO 8601).
 *
 * Misslyckas git (ingen git, inga taggar, grund klon) blir båda tomma och
 * bygget går ändå igenom; klienten visar då ingen versionstext.
 */

import { spawnSync } from "node:child_process";

/** Kör git med `args`; ger stdout (trimmad) eller `null` om git misslyckas. */
export type GitRunner = (args: readonly string[]) => string | null;

/** Den riktiga köraren: `git` i aktuell katalog, utan utskrifter på stderr. */
export const runGit: GitRunner = (args) => {
  const result = spawnSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout.trim() : null;
};

/** Byggets version och datum; tomma strängar när git inte kan svara. */
export interface BuildVersion {
  version: string;
  date: string;
}

/** Läser version och commit-datum ur git. Kastar aldrig. */
export function readBuildVersion(git: GitRunner = runGit): BuildVersion {
  const version = git(["describe", "--tags"]) ?? "";
  const date = version ? (git(["log", "-1", "--format=%cI", "HEAD"]) ?? "") : "";
  return { version, date };
}
