#!/usr/bin/env bun
/**
 * "Nytt i AVA" (#2010) till releasen: PR:ernas rad `**För användarna:**`
 * mellan förra taggen och den här, som avsnittet `## Nytt i AVA`. Tom
 * utskrift när inget syns för användarna. En PR som inte går att läsa hoppas
 * över — nyheterna får aldrig stoppa en release.
 *
 *   GH_TOKEN=… bun tooling/scripts/release-user-notes.ts v0.7.55 > nytt.md
 */
import { spawnSync } from "node:child_process";
import { releaseSection, userNoteOf } from "@/lib/shared/release-notes";

/** Kör ett kommando och ger stdout; kastar om det misslyckas. */
export type Run = (cmd: string, args: readonly string[]) => string;

const REPO = "ulrik-s/ava";

/** PR-numren i squash-commitarnas ämnesrader ("… (#123)"), äldst först. */
export function prNumbers(subjects: readonly string[]): number[] {
  return subjects.flatMap((s) => {
    const m = /\(#(\d+)\)\s*$/.exec(s);
    return m ? [Number(m[1])] : [];
  }).reverse();
}

function noteOfPr(run: Run, n: number): string | null {
  try {
    return userNoteOf(run("gh", ["api", `repos/${REPO}/pulls/${n}`, "--jq", ".body // \"\""]));
  } catch {
    return null;
  }
}

/** Avsnittet för `tag`, eller tom sträng (ingen tidigare tagg, eller inget för användarna). */
export function userNotesFor(tag: string, run: Run): string {
  let prev: string;
  try {
    prev = run("git", ["describe", "--tags", "--abbrev=0", `${tag}^`]).trim();
  } catch {
    return "";
  }
  const subjects = run("git", ["log", "--format=%s", `${prev}..${tag}`]).split("\n").filter(Boolean);
  return releaseSection(prNumbers(subjects).flatMap((n) => noteOfPr(run, n) ?? []));
}

const run: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

if (import.meta.main) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("användning: bun tooling/scripts/release-user-notes.ts <tagg>");
    process.exit(2);
  }
  process.stdout.write(userNotesFor(tag, run));
}
