#!/usr/bin/env bun
/**
 * Normalisera ett commit-subject till commitlints `subject-case` (#929).
 *
 * Dependabot skriver inkonsekvent: `ci: Bump the actions-all group…` ibland med
 * versal, ibland gement — trots `commit-message.prefix` i `.github/dependabot.yml`.
 * Versalen fäller `subject-case` och gör hela PR:en röd.
 *
 * Vi SKRIVER OM meddelandet i stället för att undanta Dependabot från commitlint.
 * Att undanta vore en uppmjukning av en grind (AGENTS.md: grindar dras bara åt),
 * och skulle dessutom släppa igenom framtida avvikelser vi inte tänkt på.
 *
 *     bun tooling/scripts/normalize-commit-subject.ts "ci: Bump foo"
 *     → ci: bump foo
 *
 * Skriver ut resultatet oförändrat när inget behöver ändras, så anroparen kan
 * jämföra och hoppa över en onödig amend (viktigt: en amend force-pushar, vilket
 * triggar workflowen igen — utan no-op-vägen blir det en loop).
 */

/**
 * Conventional-commit-huvud: `type(scope)!: beskrivning`. Bara BESKRIVNINGENS
 * första tecken gemenas — typen och scope:t rörs inte, och versaler längre in i
 * meningen (egennamn, `GitHub`, `SHA`) lämnas som de är eftersom commitlint bara
 * bryr sig om att subject:et inte är sentence-/start-/pascal-/upper-case.
 */
const HEAD_RE = /^([a-z]+(?:\([^)]*\))?!?:\s*)(.*)$/;

export function normalizeSubject(subject: string): string {
  const m = HEAD_RE.exec(subject);
  if (!m) return subject; // inget conventional-huvud → rör inte
  const [, prefix, rest] = m;
  if (!rest) return subject;
  return `${prefix}${lowerFirst(rest)}`;
}

/**
 * Gemena första tecknet — men bara när ordet inte är ETT AKRONYM. `SHA-pinna`
 * och `OPFS-cache` ska förbli versala; det är `Bump` och `Update` vi är ute
 * efter. Ett ord med två eller fler inledande versaler behandlas som akronym.
 */
function lowerFirst(text: string): string {
  if (/^[A-ZÅÄÖ]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Behöver subject:et skrivas om? Låter anroparen undvika en onödig amend. */
export function needsNormalizing(subject: string): boolean {
  return normalizeSubject(subject) !== subject;
}

if (import.meta.main) {
  const subject = process.argv[2] ?? "";
  process.stdout.write(`${normalizeSubject(subject)}\n`);
}
