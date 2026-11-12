/**
 * Den automatiska taggen: ska main släppas nu? Rena funktioner — GitHub-
 * anropen ligger i `flow-release.ts`.
 */
import type { Flow } from "./schema";
import { parseDuration } from "./watchdog";

/** `feat(time): …` → `feat`; ingen Conventional Commit → null. */
export function commitType(subject: string): string | null {
  return /^(\w+)(\([^)]*\))?!?:/.exec(subject)?.[1] ?? null;
}

/** `v0.7.9` → `v0.7.10`. */
export function nextVersion(tag: string): string {
  const [, major, minor, patch] = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) ?? [];
  if (major === undefined || minor === undefined || patch === undefined) throw new Error(`Kan inte räkna fram nästa version ur ${tag}`);
  return `v${major}.${minor}.${Number(patch) + 1}`;
}

/** Läget inför beslutet. */
export interface ReleaseInput {
  now: number;
  lastTag: string;
  lastTagAt: string;
  /** Commit-rubrikerna på main sedan senaste taggen. */
  subjects: readonly string[];
  mainSha: string;
  /** Senaste CI-körningen på main. */
  ci: { sha: string; conclusion: string | null } | null;
  /** Repovariabeln AUTO_RELEASE=off. */
  disabled: boolean;
}

/** Släpp nu (med vilken tagg), eller varför inte. */
export type ReleaseDecision = { release: true; tag: string } | { release: false; reason: string };

/** Beslutet: högst en tagg per period, bara med riktiga ändringar och grön CI på exakt main. */
export function releaseDecision(flow: Flow, input: ReleaseInput): ReleaseDecision {
  if (input.disabled) return { release: false, reason: "avstängd (AUTO_RELEASE=off)" };
  const age = input.now - new Date(input.lastTagAt).getTime();
  if (age < parseDuration(flow.release.every)) return { release: false, reason: `${input.lastTag} är bara ${Math.floor(age / 3_600_000)} h gammal` };
  const changes = input.subjects.filter((s) => flow.release.types.includes(commitType(s) ?? ""));
  if (changes.length === 0) return { release: false, reason: `inga ändringar att släppa sedan ${input.lastTag}` };
  if (input.ci?.sha !== input.mainSha || input.ci.conclusion !== "success") return { release: false, reason: "CI på main är inte grön (eller inte klar)" };
  return { release: true, tag: nextVersion(input.lastTag) };
}
