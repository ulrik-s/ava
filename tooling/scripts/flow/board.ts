/**
 * Tavlan (GitHub-projektet "AVA – flödet"): Ulriks vy över inkorgen. Varje
 * öppen förfrågan är ett kort i den kolumn som dess etiketter ger. Etiketterna
 * är sanningen; tavlan följer dem. Två flyttar är Ulriks beslut:
 *   - till **Godkänd** från Ny eller Att besluta → `verifierad`,
 *   - till **Avböjd** från ett läge där inget byggs ännu → stängd, not planned.
 * Andra flyttar läggs tillbaka. Prioriteten går åt andra hållet också: ändrar
 * Ulrik `Prio` på tavlan blir det etiketten.
 *
 * GitHub kan inte starta en workflow när ett kort flyttas, så synken läser av
 * tavlan med jämna mellanrum (`flow-board.ts`). Rena funktioner här.
 */

/** Tavlans kolumner i ordning (valen i projektets Status-fält). */
export const COLUMNS = [
  { name: "Ny", color: "GRAY", description: "Loop 1 verifierar förfrågan" },
  { name: "Att besluta", color: "YELLOW", description: "Flytta till Godkänd för att bygga, eller till Avböjd" },
  { name: "Svara", color: "RED", description: "Blockerad: läs senaste kommentaren och svara" },
  { name: "Väntar på användaren", color: "PURPLE", description: "En fråga till användaren i AVA" },
  { name: "Godkänd", color: "BLUE", description: "Loop 2 bryter ner i arbetsorder" },
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

/** Etiketterna som ger en kolumn, i företrädesordning: det som väntar på någon går först. */
const RULES: ReadonlyArray<readonly [Column, readonly string[]]> = [
  ["Svara", ["blockerad"]],
  ["Väntar på användaren", ["väntar-på-användaren"]],
  ["Godkänd", ["verifierad"]],
  ["Byggs", ["nedbruten", "dubblett"]],
  ["Klar", ["levererad", "finns-redan", "uppdelad"]],
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
  | { kind: "decline" };

/** Ulrik kan godkänna det som ännu inte är beslutat. */
const APPROVABLE: readonly Column[] = ["Ny", "Att besluta"];
/** Ulrik kan avböja det där inget byggs ännu. */
const DECLINABLE: readonly Column[] = ["Ny", "Att besluta", "Svara", "Väntar på användaren"];

/** Beslutet för ett kort: följ etiketterna, eller verkställ Ulriks flytt. */
export function decideColumn(labels: readonly string[], board: string | null): ColumnAction {
  const derived = columnFor(labels);
  if (board === derived) return { kind: "none" };
  if (board === "Godkänd" && APPROVABLE.includes(derived)) return { kind: "approve" };
  if (board === "Avböjd" && DECLINABLE.includes(derived)) return { kind: "decline" };
  return { kind: "set", column: derived };
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
