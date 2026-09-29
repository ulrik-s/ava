/**
 * Integritetskontroll: dokument med metadata men utan innehåll (#1145).
 *
 * Genererade dokument hade metadata men inget innehåll på servern i ett dygn
 * innan det upptäcktes — av användaren, när hon försökte öppna fakturan.
 * Kontrollen listar dokument vars `storagePath` saknas i innehållslagret och
 * loggar dem som `level: error` (strukturerad logg), så att det går att larma.
 *
 *   - Nya dokument räknas inte: klienten synkar raden först och laddar upp
 *     bytes:en efteråt (content-sync). Tröskel: `minAgeMs` (default 15 min).
 *   - Innehållet är adresserat efter sha: flera dokument kan dela en adress,
 *     så varje adress kontrolleras en gång.
 *   - En tom `storagePath` har aldrig haft innehåll — den rapporteras för sig.
 */

import type { Logger } from "@/lib/shared/observability/logger";
import type { StoredContentRow } from "../repositories/document-repository";

/** Hur gammalt ett dokument måste vara innan saknat innehåll räknas som fel. */
export const DEFAULT_MIN_AGE_MS = 15 * 60 * 1000;

export interface ContentIntegrityDeps {
  listStoredContent: () => Promise<StoredContentRow[]>;
  exists: (storagePath: string) => Promise<boolean>;
}

export interface ContentIntegrityReport {
  /** Antal kontrollerade dokument (efter åldersgränsen). */
  checked: number;
  /** Adresser som saknas, med dokumenten som pekar på dem. */
  missing: Array<{ storagePath: string; documentIds: string[] }>;
  /** Dokument utan adress. */
  emptyPath: string[];
}

/** Dokument som är gamla nog, grupperade per innehållsadress (tom adress för sig). */
function groupByPath(rows: readonly StoredContentRow[]): { byPath: Map<string, string[]>; emptyPath: string[] } {
  const byPath = new Map<string, string[]>();
  const emptyPath: string[] = [];
  for (const r of rows) {
    if (!r.storagePath) { emptyPath.push(r.id); continue; }
    byPath.set(r.storagePath, [...(byPath.get(r.storagePath) ?? []), r.id]);
  }
  return { byPath, emptyPath };
}

/** Vilka dokument saknar innehåll? */
export async function checkContentIntegrity(
  deps: ContentIntegrityDeps, now: Date, minAgeMs: number = DEFAULT_MIN_AGE_MS,
): Promise<ContentIntegrityReport> {
  const cutoff = now.getTime() - minAgeMs;
  const old = (await deps.listStoredContent()).filter((r) => r.createdAt.getTime() <= cutoff);
  const { byPath, emptyPath } = groupByPath(old);
  const missing: ContentIntegrityReport["missing"] = [];
  for (const [storagePath, documentIds] of byPath) {
    if (!(await deps.exists(storagePath))) missing.push({ storagePath, documentIds });
  }
  return { checked: old.length, missing, emptyPath };
}

/** Kör kontrollen och logga utfallet — `error` om något saknas (att larma på). */
export async function runContentIntegrityCheck(
  deps: ContentIntegrityDeps, log: Pick<Logger, "info" | "error">, now: Date = new Date(),
): Promise<ContentIntegrityReport> {
  const report = await checkContentIntegrity(deps, now);
  const documentIds = [...report.missing.flatMap((m) => m.documentIds), ...report.emptyPath];
  if (documentIds.length === 0) {
    log.info("content.integrity.ok", { total: report.checked, count: 0 });
    return report;
  }
  log.error("content.integrity.missing", { total: report.checked, count: documentIds.length, ids: documentIds });
  return report;
}

export interface IntegritySchedule {
  /** Kör en kontroll (fel fångas och loggas — en kontroll får aldrig ta ned servern). */
  run: () => Promise<unknown>;
  intervalMs: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Dagligen. */
export const DEFAULT_INTEGRITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Kör kontrollen nu och sedan periodiskt. Returnerar stopp-funktionen. */
export function scheduleContentIntegrity(s: IntegritySchedule): () => void {
  const setTimer = s.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = s.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const tick = (): void => { void s.run().catch(() => undefined); };
  tick();
  const handle = setTimer(tick, s.intervalMs);
  return () => clearTimer(handle);
}
