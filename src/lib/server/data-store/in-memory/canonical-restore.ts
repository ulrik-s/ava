/**
 * Återställning efter en avvisad ändring (#1348) — ingen spökrad lokalt.
 *
 * En köpost ändrar raden lokalt direkt (optimistiskt). Avvisas den, ska raden
 * se ut som på servern igen: annars lever den optimistiska raden kvar (en
 * tidspost servern vägrat skapa kunde faktureras lokalt). Pullen hjälper inte:
 * den hoppade raden medan posten låg i kön, och cursorn har flyttats förbi den.
 *
 * Serverns läge tas därför från avvisningen när servern skickade det
 * (radkonfliktens `current`, procedur-svarets rader), och hämtas annars med
 * `sync.rows` — en rad som inte finns hos byrån blir en tombstone.
 */

import { isProcedureCall, type QueueEntry } from "./mutation-queue";
import { MAX_ROW_REFS, type PulledChange, type RowRef, type SyncTransport } from "./sync-transport";

/** Tyst skrivning av en kanonisk server-rad till lokal store (utan att köa om). */
export type ApplyCanonical = (
  entity: string,
  row: Record<string, unknown>,
  deleted: boolean,
) => void | Promise<void>;

/** Nyckeln för en rad i mängder och kartor. */
export const refKey = (ref: RowRef): string => `${ref.entity}:${ref.id}`;

/** Raden en kanonisk ändring gäller. */
const refOfChange = (change: PulledChange): RowRef => ({
  entity: change.entity,
  id: typeof change.row.id === "string" ? change.row.id : "",
});

/** Raderna en köpost skrev lokalt: radpostens rad, eller anropets `touches`. */
export function refsOf(entry: QueueEntry): RowRef[] {
  if (isProcedureCall(entry)) return entry.touches;
  return [refOfChange({ entity: entry.entity, row: entry.row })];
}

/** Rader med en ej uppspelad lokal ändring (radposter och anropens `touches`). */
export function pendingKeysOf(entries: readonly QueueEntry[]): Set<string> {
  return new Set(entries.flatMap(refsOf).map(refKey));
}

/** Radernas kanoniska läge, hämtat högst {@link MAX_ROW_REFS} åt gången. */
export async function fetchCanonical(transport: Pick<SyncTransport, "rows">, refs: readonly RowRef[]): Promise<PulledChange[]> {
  const changes: PulledChange[] = [];
  for (let i = 0; i < refs.length; i += MAX_ROW_REFS) changes.push(...await transport.rows(refs.slice(i, i + MAX_ROW_REFS)));
  return changes;
}

/** Utfallet av en återställning. */
export interface RestoreOutcome {
  /** Rader som skrevs lokalt. */
  restored: number;
  /** Rader vars läge inte gick att hämta (nätet) — försöks igen nästa gång. */
  unrestored: RowRef[];
}

/**
 * Vad en reconcile ska återställa (#1348). En rad läggs till när en ändring av
 * den avvisas (eller när pullen hoppade den), och stryks när ett serversvar
 * redan har skrivit radens läge. Återställningen görs sist, och bara för rader
 * som ingen kvarvarande köpost har ändrat: en sådan rads lokala läge är
 * fortfarande optimistiskt, och den återställs när den posten avgjorts.
 */
export class RestorePlan {
  /** Rader vars kanoniska läge servern skickade med avvisningen. */
  private readonly known = new Map<string, PulledChange>();
  /** Rader vars kanoniska läge måste hämtas. */
  private readonly wanted = new Map<string, RowRef>();

  /** `carried` = rader som inte gick att återställa förra gången. */
  constructor(carried: Iterable<RowRef> = []) {
    for (const ref of carried) this.want(ref);
  }

  /** Radens läge måste hämtas. */
  want(ref: RowRef): void {
    this.known.delete(refKey(ref));
    this.wanted.set(refKey(ref), ref);
  }

  /** Servern skickade radens läge med avvisningen. */
  know(change: PulledChange): void {
    const key = refKey(refOfChange(change));
    this.wanted.delete(key);
    this.known.set(key, change);
  }

  /** Ett serversvar har redan skrivit radens läge. */
  settled(ref: RowRef): void {
    this.known.delete(refKey(ref));
    this.wanted.delete(refKey(ref));
  }

  /** Återställ raderna utan kvarvarande köpost. Ett nätfel sväljs: raderna kommer i `unrestored`. */
  async run(pending: ReadonlySet<string>, transport: Pick<SyncTransport, "rows">, apply: ApplyCanonical): Promise<RestoreOutcome> {
    const known = [...this.known].filter(([key]) => !pending.has(key)).map(([, change]) => change);
    const wanted = [...this.wanted].filter(([key]) => !pending.has(key)).map(([, ref]) => ref);
    let fetched: PulledChange[] = [];
    let unrestored: RowRef[] = [];
    try {
      fetched = await fetchCanonical(transport, wanted);
    } catch {
      unrestored = wanted;
    }
    const changes = [...known, ...fetched];
    for (const change of changes) await apply(change.entity, change.row, change.deleted ?? false);
    return { restored: changes.length, unrestored };
  }
}
