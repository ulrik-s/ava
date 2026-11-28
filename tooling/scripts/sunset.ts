/**
 * Solnedgångsregistret (#2040): en ersatt mekanism får ligga kvar under en
 * övergång, men inte längre än till sin sista dag.
 *
 * När en ADR ersätter något blir den gamla koden ofta kvar ett tag. Varje
 * sådan mekanism får en post i `tooling/config/sunset.json` med sista dag och
 * de identifierare (spår) som känner igen den. Grinden (testet
 * `test/scripts/sunset.test.ts`, en del av `bun test`) fäller när
 *
 * - en post har passerat sin sista dag och spåren finns kvar,
 * - en post saknar träffar (mekanismen är borta: stryk posten, jfr `ratchetDiff`),
 * - en ADR från {@link FIRST_CHECKED_ADR} och framåt har `**Ersätter:**` i
 *   huvudet men ingen post i registret.
 *
 * Registret ligger i den skyddade `tooling/config/`, så ett datum kan bara
 * flyttas med Ulriks `människa-godkänd` (docs/quality.md: grindar skärps bara).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { isoDayInput } from "@/lib/shared/schemas/common";
import { ratchetDiff } from "./ratchet";

/** Registret på disk. */
export const SUNSET_PATH = "tooling/config/sunset.json";

/** ADR-mappen. */
export const ADR_DIR = "docs/adr";

/** Den första ADR som måste ha en post när den ersätter något; äldre hoppas över. */
export const FIRST_CHECKED_ADR = 39;

/** En post: den ersatta mekanismen, var den syns och när den ska vara borta. */
export const sunsetEntrySchema = z.object({
  /** Kort namn på den ersatta mekanismen; felmeddelandena nämner posten med det. */
  mechanism: z.string().min(1),
  /** ADR-numret som ersatte mekanismen. */
  adr: z.number().int().positive(),
  /** `#N` (arbetsorder i ava) eller `ava-feedback#N` (förfrågan i inkorgen). */
  issue: z.string().regex(/^(ava-feedback)?#\d+$/),
  /** Sista dagen ("ÅÅÅÅ-MM-DD"); posten fäller från dagen efter. */
  lastDay: isoDayInput,
  /** Identifierare som matchas som hela ord. */
  traces: z.array(z.string().min(1)).min(1),
  /** Sökvägsprefix som söks. */
  paths: z.array(z.string().min(1)).min(1),
  /** Sökvägsprefix som hoppas över. */
  exclude: z.array(z.string().min(1)).default([]),
});

/** Registret: en lista med poster. */
export const sunsetRegistrySchema = z.array(sunsetEntrySchema);

/** En post i registret. */
export type SunsetEntry = z.output<typeof sunsetEntrySchema>;

/** En fil att söka i: sökväg relativt repots rot, och innehållet. */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** En ADR: filnamnet (`NNNN-namn.md`) och innehållet. */
export interface AdrFile {
  readonly name: string;
  readonly text: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ett uttryck som hittar något av spåren som hela ord (`documentType`, inte `documentTypes`). */
export function traceMatcher(traces: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${traces.map(escapeRegExp).join("|")})\\b`);
}

const startsWithAny = (path: string, prefixes: readonly string[]): boolean => prefixes.some((p) => path.startsWith(p));

/** Sökvägarna under postens `paths` (utom `exclude`) som innehåller något av spåren, sorterade. */
export function entryHits(entry: SunsetEntry, files: readonly SourceFile[]): string[] {
  const matcher = traceMatcher(entry.traces);
  return files
    .filter((f) => startsWithAny(f.path, entry.paths) && !startsWithAny(f.path, entry.exclude))
    .filter((f) => matcher.test(f.text))
    .map((f) => f.path)
    .sort();
}

/**
 * Posterna som passerat sin sista dag (`today > lastDay`, jämfört som
 * "ÅÅÅÅ-MM-DD") och har minst en träff. Ett fel per post, med mekanismen,
 * issuen, sista dagen och filerna.
 */
export function checkSunset(registry: readonly SunsetEntry[], files: readonly SourceFile[], today: string): string[] {
  return registry.flatMap((entry) => {
    if (today <= entry.lastDay) return [];
    const hits = entryHits(entry, files);
    if (hits.length === 0) return [];
    return [`${entry.mechanism} (${entry.issue}): sista dag var ${entry.lastDay}, men spåren finns kvar i ${hits.join(", ")}`];
  });
}

/** Posterna utan en enda träff: mekanismen är borta, så posten ska strykas ur registret. */
export function checkGone(registry: readonly SunsetEntry[], files: readonly SourceFile[]): string[] {
  const found = registry.filter((entry) => entryHits(entry, files).length > 0).map((e) => e.mechanism);
  const { gone } = ratchetDiff(found, registry.map((e) => e.mechanism));
  return gone.map((mechanism) => `${mechanism}: inga spår kvar — stryk posten ur ${SUNSET_PATH}`);
}

/** Texten före den första rubriken `## ` (ADR:ens huvud). */
export function adrHeader(text: string): string {
  const match = /^## /m.exec(text);
  return match ? text.slice(0, match.index) : text;
}

/** Numret ur ett ADR-filnamn (`0038-namn.md` → 38), eller null om namnet inte är en ADR. */
export function adrNumber(name: string): number | null {
  const match = /^(\d{4})-.*\.md$/.exec(name);
  return match ? Number(match[1]) : null;
}

const replacesSomething = (text: string): boolean => /\*\*Ersätter:\*\*/.test(adrHeader(text));

/** ADR:er från {@link FIRST_CHECKED_ADR} med `**Ersätter:**` i huvudet men utan post med samma `adr`. */
export function checkAdrs(registry: readonly SunsetEntry[], adrs: readonly AdrFile[]): string[] {
  const covered = new Set(registry.map((e) => e.adr));
  return adrs.flatMap((adr) => {
    const nr = adrNumber(adr.name);
    if (nr === null || nr < FIRST_CHECKED_ADR || covered.has(nr) || !replacesSomething(adr.text)) return [];
    return [`${ADR_DIR}/${adr.name}: ersätter en mekanism men saknar post i ${SUNSET_PATH}`];
  });
}

// ─── Läsningen från disk ─────────────────────────────────────────────────────

/** Läser och validerar registret. */
export function readRegistry(path: string = SUNSET_PATH): SunsetEntry[] {
  return parseJsonWith(sunsetRegistrySchema, readFileSync(path, "utf8"));
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
}

/** Filerna under postens `paths`, lästa från disk (rötterna är prefixens första mappnivå). */
export function readSourceFiles(registry: readonly SunsetEntry[]): SourceFile[] {
  const prefixes = registry.flatMap((e) => e.paths);
  const roots = [...new Set(prefixes.map((p) => p.split("/")[0] ?? p))];
  return roots
    .flatMap(filesUnder)
    .filter((path) => startsWithAny(path, prefixes))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** ADR:erna i `docs/adr/`. */
export function readAdrs(dir: string = ADR_DIR): AdrFile[] {
  return readdirSync(dir)
    .filter((name) => adrNumber(name) !== null)
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}
