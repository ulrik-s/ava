/**
 * Segmentering av sammansatta dokument (#1220) — "kallelse + stämning + FUP"
 * i EN PDF blir ordnade delar `{ kind, fromPage, toPage }` (1-baserat,
 * inklusive). Ren kärna (ingen I/O); LLM:en injiceras som `classify`.
 *
 * Strategi:
 *   1. Rubrikheuristik per sida: de första raderna söks efter entydiga
 *      rubriker ("KALLELSE", "STÄMNINGSANSÖKAN", "DOM", "Delgivningskvitto" …)
 *      → stark start med känd kategori. Svagare signaler — sidnumret börjar om
 *      ("1 (4)", "Sida 1 av 3") eller en aktbilage-stämpel — ger en trolig
 *      start med OKÄND kategori.
 *   2. LLM:en frågas BARA om kandidat-startsidor utan känd kategori (första
 *      ~1500 tecknen av sidan; ett dokument med en enda kandidat skickar hela
 *      texten, som förut). Antalet anrop är begränsat (`maxLlmCalls`) — en
 *      300-sidig FUP får inte ta evigheter. Utöver taket: bara heuristik.
 *   3. Sidor utan ny start hör till föregående del; intilliggande delar med
 *      samma kategori slås ihop. Inne i en FUP (en akt med förhör, protokoll
 *      och bilagor som själva har sidnumrering) bryter bara en STARK rubrik.
 *
 * Kategorier utan egen kod (valdes bort, #1220) mappas deterministiskt:
 *   - Yttrande/svaromål/överklagande → INLAGA
 *   - Föreläggande/beslut → DOM (kategorin "Dom/beslut")
 *   - Underrättelse → OKLASSIFICERAT ("Övrigt") — det är domstolens följebrev;
 *     delen efter (t.ex. motpartens yttrande) klassas för sig.
 */

import type { DocumentKind } from "./document-kind";

/** En del av ett dokument. Sidorna är 1-baserade och inklusiva. */
export interface SegmentPart {
  kind: DocumentKind;
  fromPage: number;
  toPage: number;
}

/** Klassificera en text till EN kategori; null = okänt/fel (heuristiken får avgöra). */
export type PartClassifier = (text: string) => Promise<DocumentKind | null>;

export interface SegmentOptions {
  /** Kategori när varken rubrik eller LLM ger svar för första sidan (t.ex. filnamns-heuristiken). */
  fallbackKind: DocumentKind;
  /** LLM-klassificerare för kandidatsidor. Saknas → bara heuristik. */
  classify?: PartClassifier;
  /** Max antal LLM-anrop per dokument (default `DEFAULT_MAX_LLM_CALLS`). */
  maxLlmCalls?: number;
}

/**
 * Tak för LLM-anrop per dokument. qwen2.5:1.5b på prod-servern tar ~11 s per
 * anrop → 12 anrop ≈ 2 min i värsta fall. Ett vanligt enkeldokument = 1 anrop.
 */
export const DEFAULT_MAX_LLM_CALLS = 12;
/** Tecken av en kandidatsida som skickas till LLM:en. */
const PAGE_LLM_CHARS = 1500;
/** Tecken av hela texten när dokumentet bara har en kandidat (som före #1220). */
const WHOLE_LLM_CHARS = 6000;
/** Antal icke-tomma rader i sidans topp/botten som söks efter startsignaler. */
const HEAD_LINES = 8;
const TAIL_LINES = 3;
/** En rubrikrad är kort — längre rader är brödtext som råkar börja med ordet. */
const TITLE_MAX_LEN = 60;

/** Ordslut: radslut, blanktecken eller skiljetecken (inte `\b`, som är ASCII-baserat). */
const END = String.raw`(?=$|[\s:;,.()\-–])`;
const title = (words: string): RegExp => new RegExp(String.raw`^(?:${words})${END}`, "iu");

/** Rubrikregler i prioritetsordning (specifik före generell). */
const TITLE_RULES: ReadonlyArray<readonly [RegExp, DocumentKind]> = [
  [title("förundersökningsprotokoll"), "FUP"],
  [title("delgivningskvitto|mottagningsbevis"), "DELGIVNINGSKVITTO"],
  [title("kallelse"), "KALLELSE"],
  [title("stämningsansökan|stämning"), "STAMNING"],
  [title("dom|deldom|mellandom|tredskodom"), "DOM"],
  [title("beslut|slutligt beslut|föreläggande"), "DOM"],
  [title("underrättelse"), "OKLASSIFICERAT"],
  [title("yttrande|svaromål|överklagande|inlaga|bemötande"), "INLAGA"],
  [title("fullmakt"), "FULLMAKT"],
];

/** Sidnumrering som börjar om: "1 (4)", "Sida 1 av 3", "Sida 1 (3)". */
const RESTART = /^(?:sida\s+)?1\s*(?:\(\s*\d+\s*\)|av\s+\d+)$/iu;
/** Domstolens aktbilage-stämpel på första sidan av en ingiven handling. */
const AKTBILAGA = /^aktbil(?:aga)?\.?\s*\d+/iu;

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/** Kategori ur en rubrikrad i sidans topp; null om ingen entydig rubrik. */
function titleKind(head: readonly string[]): DocumentKind | null {
  for (const line of head) {
    if (line.length > TITLE_MAX_LEN) continue;
    const rule = TITLE_RULES.find(([re]) => re.test(line));
    if (rule) return rule[1];
  }
  return null;
}

/**
 * Startsignal på en sida. `{ kind }` = stark start (entydig rubrik),
 * `{ kind: null }` = trolig start med okänd kategori, `null` = ingen start.
 */
export function detectPageStart(text: string): { kind: DocumentKind | null } | null {
  const lines = nonEmptyLines(text);
  const head = lines.slice(0, HEAD_LINES);
  const kind = titleKind(head);
  if (kind) return { kind };
  const edges = [...head, ...lines.slice(-TAIL_LINES)];
  return edges.some((l) => RESTART.test(l) || AKTBILAGA.test(l)) ? { kind: null } : null;
}

/** En kandidat-startsida (1-baserad) med ev. heuristisk kategori. */
interface Candidate {
  page: number;
  kind: DocumentKind | null;
}

/** Kandidat-startsidor. Sida 1 är alltid en start. */
export function findCandidates(pages: readonly string[]): Candidate[] {
  const out: Candidate[] = [];
  pages.forEach((text, i) => {
    const start = detectPageStart(text);
    if (i === 0 || start) out.push({ page: i + 1, kind: start?.kind ?? null });
  });
  return out;
}

/** Slå ihop intilliggande delar med samma kategori. */
export function mergeAdjacent(parts: readonly SegmentPart[]): SegmentPart[] {
  const out: SegmentPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.kind === part.kind && last.toPage + 1 === part.fromPage) last.toPage = part.toPage;
    else out.push({ ...part });
  }
  return out;
}

/** Löpande tillstånd när kandidaterna avgörs i sidordning. */
interface Resolver {
  pages: readonly string[];
  single: boolean;
  opts: SegmentOptions;
  callsLeft: number;
}

/** Texten LLM:en får för en kandidat. */
function llmInput(r: Resolver, page: number): string {
  return r.single ? r.pages.join("\n\n").slice(0, WHOLE_LLM_CHARS) : (r.pages[page - 1] ?? "").slice(0, PAGE_LLM_CHARS);
}

/** Fråga LLM:en om kandidaten, inom taket. null = inget svar/taket nått. */
async function askLlm(r: Resolver, page: number): Promise<DocumentKind | null> {
  if (!r.opts.classify || r.callsLeft <= 0) return null;
  r.callsLeft -= 1;
  return r.opts.classify(llmInput(r, page));
}

/**
 * Avgör en kandidats kategori. null = ingen ny del (sidan hör till föregående).
 * Stark rubrik vinner; inne i en FUP bryter bara en stark rubrik; annars LLM.
 */
async function resolveKind(r: Resolver, c: Candidate, current: DocumentKind | null): Promise<DocumentKind | null> {
  if (c.kind) return c.kind;
  if (current === "FUP") return null;
  const asked = await askLlm(r, c.page);
  return asked ?? (current === null ? r.opts.fallbackKind : null);
}

/**
 * Segmentera ett dokuments sidor till delar. Tom sidlista → inga delar
 * (ingen text server-side). En sida (DOCX/text) → en del.
 */
export async function segmentPages(pages: readonly string[], opts: SegmentOptions): Promise<SegmentPart[]> {
  if (pages.length === 0) return [];
  const candidates = findCandidates(pages);
  const r: Resolver = { pages, single: candidates.length === 1, opts, callsLeft: opts.maxLlmCalls ?? DEFAULT_MAX_LLM_CALLS };
  const starts: Array<{ page: number; kind: DocumentKind }> = [];
  for (const c of candidates) {
    const kind = await resolveKind(r, c, starts[starts.length - 1]?.kind ?? null);
    if (kind) starts.push({ page: c.page, kind });
  }
  const parts = starts.map((s, i): SegmentPart => ({
    kind: s.kind, fromPage: s.page, toPage: (starts[i + 1]?.page ?? pages.length + 1) - 1,
  }));
  return mergeAdjacent(parts);
}

/** En del med ursprung — för sammanvägning med användarens rättelser. */
export interface SourcedPart extends SegmentPart {
  source: "AUTO" | "MANUAL";
}

/** Sidorna i `part` som inte täcks av någon manuell del (0–n fragment). */
function uncovered(part: SegmentPart, manual: readonly SegmentPart[]): SegmentPart[] {
  let fragments: SegmentPart[] = [part];
  for (const m of manual) {
    fragments = fragments.flatMap((f) => [
      ...(f.fromPage < m.fromPage ? [{ ...f, toPage: Math.min(f.toPage, m.fromPage - 1) }] : []),
      ...(f.toPage > m.toPage ? [{ ...f, fromPage: Math.max(f.fromPage, m.toPage + 1) }] : []),
    ].filter((x) => x.fromPage <= x.toPage));
  }
  return fragments;
}

/**
 * Väg ihop en ny automatisk segmentering med användarens manuella delar:
 * manuella delar vinner över sina sidor, de automatiska fyller resten.
 * Resultatet är sorterat på sidordning; bara AUTO-delar slås ihop.
 */
export function overlayManualParts(auto: readonly SegmentPart[], manual: readonly SegmentPart[]): SourcedPart[] {
  const autoParts = mergeAdjacent(auto.flatMap((a) => uncovered(a, manual)))
    .map((p): SourcedPart => ({ ...p, source: "AUTO" }));
  const manualParts = manual.map((p): SourcedPart => ({ kind: p.kind, fromPage: p.fromPage, toPage: p.toPage, source: "MANUAL" }));
  return [...autoParts, ...manualParts].sort((a, b) => a.fromPage - b.fromPage);
}
