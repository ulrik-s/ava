/**
 * Köns formatversion (#1247) — hantera ändringar från äldre klientkod.
 *
 * En klient som varit offline länge kan ha köat ändringar skrivna av äldre
 * kod: andra fält, andra procedur-input. Varje köpost stämplas därför med
 * formatet den skrevs i (`format`), och servern avgör:
 *
 *   - `current`  — samma format; köras som vanligt.
 *   - `migrate`  — ett äldre format servern kan lyfta steg för steg
 *                  (`QUEUE_MIGRATIONS`) till dagens.
 *   - `too-old`  — äldre än servern stöder; avvisas med ett tydligt besked
 *                  (aldrig tyst). Kön fastnar inte.
 *   - `too-new`  — klienten är nyare än servern (servern ej uppgraderad än);
 *                  inget utfall, klienten försöker igen senare — arbetet ligger
 *                  kvar i kön.
 *
 * Poster utan stämpel skrevs före #1247, i format 1.
 *
 * Höj `QUEUE_FORMAT_VERSION` när köpostens form eller en köbar procedurs input
 * ändras på ett sätt äldre poster inte klarar, och lägg till migreringen från
 * den förra versionen i `QUEUE_MIGRATIONS`.
 */

/** Formatet den här koden skriver. */
export const QUEUE_FORMAT_VERSION = 1;

/** Det äldsta format servern tar emot (migrerat vid behov). */
export const MIN_QUEUE_FORMAT_VERSION = 1;

/** Den del av en köpost som migreras: procedurens sökväg + input, eller radens entitet + rad. */
export interface QueuePayload {
  readonly path?: string;
  readonly input?: Record<string, unknown>;
  readonly entity?: string;
  readonly row?: Record<string, unknown>;
}

/** Lyfter en post från format `n` till `n + 1`. */
export type QueueMigration = (payload: QueuePayload) => QueuePayload;

/** `QUEUE_MIGRATIONS[n]` lyfter format `n` → `n + 1`. Tom så länge format 1 är det enda. */
export const QUEUE_MIGRATIONS: Readonly<Record<number, QueueMigration>> = Object.freeze({});

/** Hur en post i ett visst format ska hanteras. */
export type QueueFormatVerdict = "current" | "migrate" | "too-old" | "too-new";

/** Formatet en post skrevs i (osämplade poster = 1). */
export function formatOf(entry: { format?: number | undefined }): number {
  return entry.format ?? 1;
}

export interface FormatBounds {
  current: number;
  min: number;
}

/** Gränserna och migreringarna servern tillämpar (injicerbara i tester). */
export interface QueuePolicy extends FormatBounds {
  migrations: Readonly<Record<number, QueueMigration>>;
}

/** Dagens policy. */
export const QUEUE_POLICY: QueuePolicy = Object.freeze({
  current: QUEUE_FORMAT_VERSION, min: MIN_QUEUE_FORMAT_VERSION, migrations: QUEUE_MIGRATIONS,
});

/** Vad ska servern göra med en post i format `format`? */
export function classifyQueueFormat(format: number, bounds: FormatBounds = QUEUE_POLICY): QueueFormatVerdict {
  if (format > bounds.current) return "too-new";
  if (format < bounds.min) return "too-old";
  return format === bounds.current ? "current" : "migrate";
}

/**
 * Lyft en post till dagens format. Saknas ett steg (en bugg: ett format som
 * räknas som stött men saknar migrering) kastas — hellre ett tekniskt fel
 * klienten försöker om än en post som körs i fel format.
 */
export function migrateQueuePayload(
  payload: QueuePayload,
  from: number,
  migrations: Readonly<Record<number, QueueMigration>> = QUEUE_MIGRATIONS,
  to: number = QUEUE_FORMAT_VERSION,
): QueuePayload {
  let current = payload;
  for (let v = from; v < to; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Ingen migrering av köposten från format ${v} till ${v + 1}.`);
    current = step(current);
  }
  return current;
}

/** Beskedet till användaren när en ändring är för gammal för servern. */
export function tooOldMessage(format: number): string {
  return `Ändringen gjordes i en för gammal version av AVA (köformat ${format}) och kan inte sparas på servern. `
    + "Gör om den i den nya versionen.";
}

/** Felet när klienten är nyare än servern — tekniskt, inte ett utfall (försök igen senare). */
export function tooNewMessage(format: number): string {
  return `Servern kör en äldre version av AVA än klienten (köformat ${format}). Ändringen sparas när servern har uppgraderats.`;
}
