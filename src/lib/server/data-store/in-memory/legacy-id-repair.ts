/**
 * Reparera lokala rader med icke-uuid-id (dataförlust ava-crm.io 2026-09-23).
 *
 * `WritableDelegate` genererade id:n som `muej66a9-jd9ieu` för rader skapade i
 * klienten. Servern lagrar bara uuid-nycklade rader och svarade "accepted" utan
 * att spara (#879) → klienten ackade, kön tömdes, och raden fanns BARA i den
 * lokala storen. Den här reparationen körs vid uppstart, innan första reconcile:
 *
 *  1. Varje icke-uuid-id mappas till ett DETERMINISTISKT uuidv5(gammalt id) —
 *     samma id oavsett hur många gånger reparationen körs.
 *  2. Varje sträng som exakt är ett gammalt id skrivs om — i alla rader och i
 *     alla köade mutationer. Främmande nycklar (ärendets klient, tidpostens
 *     ärende …) följer då med automatiskt.
 *  3. Varje reparerad rad köas som `create` (i skapandeordning, så en klient
 *     skapas före ärendet som pekar på den). Serverns create är idempotent.
 *
 * Ren funktion: inga sidoeffekter, anroparen persisterar resultatet.
 */

import { isUuid } from "@/lib/shared/uuid";
import { uuidv5 } from "@/lib/shared/uuid-derive";
import { ENTITY_NAME_BY_SOURCE_KEY } from "./entity-source-keys";
import type { QueuedMutation } from "./mutation-queue";

/** Fast namnrymd för reparationen — ändras aldrig (id:n måste bli desamma). */
export const LEGACY_ID_NAMESPACE = "6f1c2a5e-8b3d-4e7a-9c21-5d4b3a2f1e0c";

type Row = Record<string, unknown>;

export interface RecreatedRow {
  entity: string;
  row: Row;
}

export interface LegacyIdRepair<S extends object> {
  /** false → inget att göra; source/queued är orörda. */
  changed: boolean;
  source: S;
  queued: QueuedMutation[];
  /** Reparerade rader att köa som `create`, i skapandeordning. */
  recreated: RecreatedRow[];
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((r): r is Row => typeof r === "object" && r !== null) : [];
}

function legacyIdOf(row: Row): string | null {
  const id = row.id;
  return typeof id === "string" && id !== "" && !isUuid(id) ? id : null;
}

/** Gammalt id → nytt uuid, för varje källtabell som klienten synkar. */
function buildIdMap(source: object): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of Object.keys(ENTITY_NAME_BY_SOURCE_KEY)) {
    for (const row of rowsOf(Reflect.get(source, key))) {
      const old = legacyIdOf(row);
      if (old) map.set(old, uuidv5(old, LEGACY_ID_NAMESPACE));
    }
  }
  return map;
}

/** Skriv om varje sträng som exakt är ett gammalt id — rekursivt genom objekt/listor. */
function rewrite(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value instanceof Date || typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, map)]));
}

function createdAtMs(row: Row): number {
  const t = row.createdAt;
  const ms = t instanceof Date ? t.getTime() : typeof t === "string" ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** De reparerade raderna som `create`, äldst först (beroendeordning). */
function recreatedRows(source: object, map: ReadonlyMap<string, string>): RecreatedRow[] {
  const newIds = new Set(map.values());
  const out: RecreatedRow[] = [];
  for (const [key, entity] of Object.entries(ENTITY_NAME_BY_SOURCE_KEY)) {
    for (const row of rowsOf(Reflect.get(source, key))) {
      if (typeof row.id === "string" && newIds.has(row.id)) out.push({ entity, row });
    }
  }
  return out.sort((a, b) => createdAtMs(a.row) - createdAtMs(b.row));
}

export function repairLegacyIds<S extends object>(source: S, queued: readonly QueuedMutation[]): LegacyIdRepair<S> {
  const map = buildIdMap(source);
  if (map.size === 0) return { changed: false, source, queued: [...queued], recreated: [] };
  // `rewrite` byter bara strängvärden — nycklar och struktur är oförändrade,
  // så resultatet har samma form som `source`.
  const repairedSource = rewrite(source, map) as S;
  return {
    changed: true,
    source: repairedSource,
    queued: queued.map((m) => rewrite(m, map) as QueuedMutation),
    recreated: recreatedRows(repairedSource, map),
  };
}
