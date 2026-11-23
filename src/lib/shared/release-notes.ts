/**
 * "Nytt i AVA" (#2010): korta nyheter på vardaglig svenska för juristerna.
 *
 * Varje agent-PR har en rad `**För användarna:** …` (eller `—` när inget
 * syns för användarna). När en tagg sätts samlar release-workflowen raderna
 * under rubriken `## Nytt i AVA` i GitHub-releasen; servern läser rubriken
 * och appen visar den första gången man öppnar AVA efter en uppdatering.
 */
import { z } from "zod";

/** Rubriken i GitHub-releasen. */
export const RELEASE_NOTES_HEADING = "## Nytt i AVA";
/** Raden i en PR-beskrivning. */
export const USER_NOTE_PREFIX = "**För användarna:**";
/** Så många versioner visas som mest på en gång. */
export const MAX_UNSEEN_RELEASES = 5;

/** Nyheterna i en version. */
export const releaseNoteSchema = z.object({
  version: z.string(),
  date: z.string(),
  items: z.array(z.string()),
});
/** Nyheterna i en version. */
export type ReleaseNote = z.infer<typeof releaseNoteSchema>;

const NOTHING = new Set(["", "—", "-", "–"]);

/** PR-beskrivningens rad för användarna, eller null om den saknas eller säger att inget syns. */
export function userNoteOf(prBody: string): string | null {
  const line = prBody.split("\n").find((l) => l.trimStart().startsWith(USER_NOTE_PREFIX));
  const text = line?.trimStart().slice(USER_NOTE_PREFIX.length).trim() ?? "";
  return NOTHING.has(text) ? null : text;
}

/** Releasens avsnitt ur PR:ernas rader; tom sträng när inget syns för användarna. */
export function releaseSection(notes: readonly string[]): string {
  return notes.length === 0 ? "" : [RELEASE_NOTES_HEADING, "", ...notes.map((n) => `- ${n}`), ""].join("\n");
}

/** Punkterna under `## Nytt i AVA` i en release-text (tom om rubriken saknas). */
export function extractUserNotes(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === RELEASE_NOTES_HEADING);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
}

/** En version som tal: [major, minor, patch]. */
type Version = readonly [number, number, number];

/** `vX.Y.Z`, eller `vX.Y.Z-3-gabc` från ett bygge mellan taggar, som tal; annars null. */
export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negativt om a är äldre än b, 0 om samma, positivt om nyare. */
function compare(a: Version, b: Version): number {
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

/**
 * Versionerna användaren inte sett: nyare än `lastSeen` och inte nyare än den
 * som kör, nyast först. Har användaren aldrig sett något visas bara den som kör.
 */
export function unseenReleases(notes: readonly ReleaseNote[], lastSeen: string | null, current: string): ReleaseNote[] {
  const cur = parseVersion(current);
  if (cur === null) return [];
  const seen = lastSeen === null ? null : parseVersion(lastSeen);
  const isUnseen = (v: Version): boolean => compare(v, cur) <= 0 && (seen === null ? compare(v, cur) === 0 : compare(v, seen) > 0);
  return notes
    .flatMap((note) => {
      const v = parseVersion(note.version);
      return v !== null && isUnseen(v) ? [{ note, v }] : [];
    })
    .sort((a, b) => compare(b.v, a.v))
    .slice(0, MAX_UNSEEN_RELEASES)
    .map(({ note }) => note);
}
