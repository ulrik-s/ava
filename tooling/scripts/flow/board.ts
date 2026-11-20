/**
 * Tavlan (GitHub-projektet "AVA – flödet"): Ulriks vy över inkorgen. Varje
 * öppen förfrågan är ett kort i den kolumn som dess etiketter ger. Etiketterna
 * är sanningen; tavlan följer dem. Två flyttar är Ulriks beslut:
 *   - till **Godkänd** från Ny eller Att besluta → `verifierad`,
 *   - till **Avböjd** från ett läge där inget byggs ännu → stängd, not planned.
 * Andra flyttar läggs tillbaka. Prioriteten går åt andra hållet också: ändrar
 * Ulrik `Prio` på tavlan blir det etiketten.
 *
 * Automatiskt godkännande: loop 1 sätter `auto-godkänn` på en liten bekräftad
 * bugg eller ett internt verktyg utan risk. Kortet står i "Godkänns
 * automatiskt", och efter 24 h utan veto sätter synken `verifierad` med Ulriks
 * token. Veto: flytta kortet till Att besluta (eller Avböjd).
 *
 * GitHub kan inte starta en workflow när ett kort flyttas, så synken läser av
 * tavlan med jämna mellanrum (`flow-board.ts`). Rena funktioner här.
 */

/** Tavlans kolumner i ordning (valen i projektets Status-fält). */
export const COLUMNS = [
  { name: "Ny", color: "GRAY", description: "Loop 1 verifierar förfrågan" },
  { name: "Att besluta", color: "YELLOW", description: "Flytta till Godkänd för att bygga, eller till Avböjd" },
  { name: "Godkänns automatiskt", color: "PINK", description: "Godkänns efter 24 h. Flytta till Att besluta (veto) eller Avböjd för att stoppa" },
  { name: "Svara", color: "RED", description: "Blockerad: läs senaste kommentaren och svara" },
  { name: "Väntar på användaren", color: "PURPLE", description: "En fråga till användaren i AVA" },
  { name: "Godkänd", color: "BLUE", description: "Loop 2 bryter ner i arbetsorder" },
  { name: "Designas", color: "BLUE", description: "Större ändring: loop 2 designar, loop 3 granskar. Frågor hamnar i Svara" },
  { name: "Byggs", color: "ORANGE", description: "Arbetsorder i ava byggs och granskas" },
  { name: "Klar", color: "GREEN", description: "Levererad eller avslutad" },
  { name: "Avböjd", color: "GRAY", description: "Flytta hit för att stänga utan att bygga" },
] as const;

/** En kolumn på tavlan. */
export type Column = (typeof COLUMNS)[number]["name"];

/** Prioriteterna i ordning (valen i projektets Prio-fält, `prio-<p>` som etikett). */
export const PRIOS = ["hög", "medel", "låg"] as const;

/** En prioritet. */
export type Prio = (typeof PRIOS)[number];

/** Loop 1:s flagga för det som godkänns automatiskt efter vetofönstret. */
export const AUTO_LABEL = "auto-godkänn";

/** Etiketterna som ger en kolumn, i företrädesordning: det som väntar på någon går först. */
const RULES: ReadonlyArray<readonly [Column, readonly string[]]> = [
  ["Svara", ["blockerad"]],
  ["Väntar på användaren", ["väntar-på-användaren"]],
  ["Godkänd", ["verifierad", "design-godkänd"]],
  ["Designas", ["designas", "design-granskas"]],
  ["Byggs", ["nedbruten", "dubblett"]],
  ["Klar", ["levererad", "finns-redan", "uppdelad"]],
  ["Godkänns automatiskt", [AUTO_LABEL]],
  ["Att besluta", ["undersökt"]],
];

/** Etiketterna kolumnerna bygger på (för testet mot flow.yaml). */
export const COLUMN_LABELS: readonly string[] = RULES.flatMap(([, ls]) => ls);

/** Kolumnen som förfrågans etiketter ger (utan tillstånd: Ny). */
export function columnFor(labels: readonly string[]): Column {
  return RULES.find(([, ls]) => ls.some((l) => labels.includes(l)))?.[0] ?? "Ny";
}

/** Vad synken gör med ett korts kolumn. */
export type ColumnAction =
  | { kind: "none" }
  | { kind: "set"; column: Column }
  | { kind: "approve" }
  | { kind: "decline" }
  | { kind: "veto" };

/** Ulrik kan godkänna det som ännu inte är beslutat. */
const APPROVABLE: readonly Column[] = ["Ny", "Att besluta", "Godkänns automatiskt"];
/** Ulrik kan avböja det där inget byggs ännu. */
const DECLINABLE: readonly Column[] = ["Ny", "Att besluta", "Godkänns automatiskt", "Svara", "Väntar på användaren", "Designas"];

/** Beslutet för ett kort: följ etiketterna, eller verkställ Ulriks flytt. */
export function decideColumn(labels: readonly string[], board: string | null): ColumnAction {
  const derived = columnFor(labels);
  if (board === derived) return { kind: "none" };
  if (board === "Godkänd" && APPROVABLE.includes(derived)) return { kind: "approve" };
  if (board === "Avböjd" && DECLINABLE.includes(derived)) return { kind: "decline" };
  if (board === "Att besluta" && derived === "Godkänns automatiskt") return { kind: "veto" };
  return { kind: "set", column: derived };
}

/** Rekommendationerna (valen i projektets Rekommendation-fält, `rek-<r>` som etikett). */
export const REKS = ["godkänn", "avböj", "fråga"] as const;

/** En rekommendation från loop 1. */
export type Rek = (typeof REKS)[number];

/** Rekommendationen etiketterna bär, eller null. */
export const rekFor = (labels: readonly string[]): Rek | null => REKS.find((r) => labels.includes(`rek-${r}`)) ?? null;

/** Det Läge-texten behöver utöver etiketterna. */
export interface LageContext {
  /** När `auto-godkänn` sattes (ISO), för kort som godkänns automatiskt. */
  autoSince?: string;
  /** Arbetsordrarna i kodrepot för förfrågan: hur många som är klara av alla. */
  workOrders?: { done: number; total: number };
}

const when = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);

const releaseOf = (labels: readonly string[]): string | undefined => labels.find((l) => l.startsWith("release:"))?.slice("release:".length);

function builtText(labels: readonly string[], ctx: LageContext): string {
  if (labels.includes("dubblett")) return "Dubblett — följer originalet";
  const wo = ctx.workOrders;
  return wo && wo.total > 0 ? `Byggs: ${wo.done} av ${wo.total} arbetsorder klara` : "Bryts ner i arbetsorder i kodrepot";
}

function doneText(labels: readonly string[]): string {
  if (labels.includes("finns-redan")) return "Fanns redan i AVA";
  if (labels.includes("uppdelad")) return "Uppdelad i egna förfrågningar";
  const release = releaseOf(labels);
  return release === undefined ? "Levererad" : `Levererad i ${release}`;
}

/** Läge-texten per kolumn: vad som händer med förfrågan nu. */
const LAGE: Readonly<Record<Column, (labels: readonly string[], ctx: LageContext) => string>> = {
  "Ny": () => "Loop 1 verifierar förfrågan",
  "Att besluta": (labels) => {
    const rek = rekFor(labels);
    return rek === null ? "Väntar på ditt beslut" : `Väntar på ditt beslut — rekommendation: ${rek}`;
  },
  "Godkänns automatiskt": (_, ctx) => (ctx.autoSince === undefined
    ? "Godkänns automatiskt efter 24 h om du inte flyttar den"
    : `Godkänns automatiskt ${when(new Date(ctx.autoSince).getTime() + AUTO_APPROVE_MS)} om du inte flyttar den`),
  "Svara": () => "Blockerad — läs senaste kommentaren och svara i issuen",
  "Väntar på användaren": () => "Loop 1 har frågat användaren i AVA och väntar på svar",
  "Godkänd": (labels) => (labels.includes("design-godkänd")
    ? "Designen godkänd — loop 2 bryter ner den enligt designen"
    : "Godkänd — loop 2 bryter ner den i arbetsorder"),
  "Designas": (labels) => (labels.includes("design-granskas")
    ? "Designen granskas av loop 3 mot ADR:erna"
    : "Loop 2 designar lösningen (frågor hamnar i Svara)"),
  "Byggs": builtText,
  "Klar": doneText,
  "Avböjd": () => "Avböjd",
};

/** Läget på kortet, i klartext, ur etiketterna. */
export const lageFor = (labels: readonly string[], ctx: LageContext = {}): string => LAGE[columnFor(labels)](labels, ctx);

/** Vetofönstret: så länge står ett kort i "Godkänns automatiskt" innan det godkänns. */
export const AUTO_APPROVE_MS = 24 * 3_600_000;

/** Flaggor som stoppar det automatiska godkännandet: någon väntar på svar. */
const HOLD = ["blockerad", "väntar-på-användaren"];

/**
 * Får förfrågan godkännas automatiskt? Loop 1 har bedömt den (`auto-godkänn`
 * på en undersökt förfrågan), och koden kontrollerar det som går att se:
 * en bugg eller internt arbete, aldrig en användares förslag, och ingen väntar.
 */
export function autoApprovable(labels: readonly string[]): boolean {
  const has = (l: string): boolean => labels.includes(l);
  const kindOk = has("intern") || (has("bugg") && !has("förslag"));
  return has(AUTO_LABEL) && has("undersökt") && !has("verifierad") && kindOk && !HOLD.some(has);
}

/** Har förfrågan stått vetofönstret ut sedan `auto-godkänn` sattes (`since`, ISO)? */
export function autoApproveDue(labels: readonly string[], since: string | undefined, now: number): boolean {
  return since !== undefined && autoApprovable(labels) && now - new Date(since).getTime() >= AUTO_APPROVE_MS;
}

/** Vad synken gör med ett korts prioritet. */
export type PrioAction =
  | { kind: "none" }
  | { kind: "set-board"; prio: Prio }
  | { kind: "set-label"; prio: Prio; remove: string[] };

const isPrio = (v: string | null): v is Prio => v !== null && (PRIOS as readonly string[]).includes(v);

/**
 * Prioriteten: saknas den på tavlan tas den från etiketten (loop 1:s bedömning);
 * har Ulrik satt den på tavlan och den skiljer sig blir den etiketten.
 */
export function decidePrio(labels: readonly string[], board: string | null): PrioAction {
  const label = PRIOS.find((p) => labels.includes(`prio-${p}`)) ?? null;
  if (board === label) return { kind: "none" };
  if (!isPrio(board)) return label === null ? { kind: "none" } : { kind: "set-board", prio: label };
  return { kind: "set-label", prio: board, remove: labels.filter((l) => l.startsWith("prio-") && l !== `prio-${board}`) };
}
