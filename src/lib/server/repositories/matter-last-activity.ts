/**
 * "Senast hänt" i ett ärende (#1967) för minnesrepot: ren logik utan I/O.
 * Definitionen står vid `MatterListOrder` i `matter-repository.ts`; Drizzle-
 * repot gör samma sak i SQL.
 */

import type { MatterId } from "@/lib/shared/schemas/ids";

/** En post i ärendet (tidspost, utlägg, dokument eller tjänsteanteckning). */
export interface MatterActivityRow {
  matterId: string;
  updatedAt?: Date | string | null | undefined;
  deletedAt?: Date | string | null | undefined;
}

/** Det jämföraren behöver av ärendet. */
export interface MatterActivityTarget {
  id: string;
  createdAt?: Date | string | null | undefined;
}

/** Tidpunkten i millisekunder; synkade rader bär ISO-strängar. Saknas den: 0. */
function timeOf(v: Date | string | null | undefined): number {
  return v ? new Date(v).getTime() : 0;
}

/**
 * Senaste `updatedAt` per ärende bland `matterIds`. Raderade rader och rader
 * för andra ärenden hoppas över; ett ärende utan poster saknas i kartan.
 */
export function lastActivityByMatter(rows: readonly MatterActivityRow[], matterIds: readonly MatterId[]): Map<string, number> {
  const wanted = new Set<string>(matterIds);
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.deletedAt || !wanted.has(row.matterId)) continue;
    const t = timeOf(row.updatedAt);
    if (t > (out.get(row.matterId) ?? Number.NEGATIVE_INFINITY)) out.set(row.matterId, t);
  }
  return out;
}

/** Bytevis fallande, som Postgres jämför uuid (gemena hex-strängar). */
function idDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/**
 * Jämföraren för `orderBy: "lastActivity"`: senast hänt fallande (ärendets
 * `createdAt` om det saknar poster), sedan `createdAt` fallande, sist `id`
 * fallande bytevis.
 */
export function compareLastActivity(activity: ReadonlyMap<string, number>): (a: MatterActivityTarget, b: MatterActivityTarget) => number {
  const lastOf = (m: MatterActivityTarget): number => activity.get(m.id) ?? timeOf(m.createdAt);
  return (a, b) => lastOf(b) - lastOf(a) || timeOf(b.createdAt) - timeOf(a.createdAt) || idDesc(a.id, b.id);
}
