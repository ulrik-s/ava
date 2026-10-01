/**
 * Invarianterna lasttestet prövar (#1366) — ren logik, testad för sig.
 *
 *   - nummerserier: inga dubbletter, inga luckor (fakturor F-ÅÅÅÅ-NNNN och
 *     kostnadsräkningar KR-ÅÅÅÅ-NNNN, ADR 0012),
 *   - ingen ändring förlorad eller dubblerad efter en anslutningsstorm,
 *   - klienternas lokala läge = serverns (konvergens),
 *   - samma mutation från flera flikar tillämpas en gång (idempotens).
 */

/** Utfallet för en nummerserie (per byrå och prefix). */
export interface SeriesCheck {
  prefix: string;
  count: number;
  duplicates: string[];
  /** Saknade löpnummer mellan 1 och det högsta som tilldelats. */
  gaps: number[];
  /** Nummer som inte följer formatet `PREFIX-NNNN`. */
  malformed: string[];
}

const SERIAL = /^(.*-)(\d+)$/;

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }
  return [...dup].sort();
}

function missingSerials(serials: ReadonlySet<number>): number[] {
  const max = Math.max(0, ...serials);
  const gaps: number[] = [];
  for (let n = 1; n <= max; n++) if (!serials.has(n)) gaps.push(n);
  return gaps;
}

/**
 * Pröva en serie: numren grupperas per prefix (`F-2026-`), och varje prefix
 * ska ha löpnummer 1..max utan hål och utan dubbletter.
 */
export function checkSeries(numbers: readonly string[]): SeriesCheck[] {
  const byPrefix = new Map<string, string[]>();
  const malformed: string[] = [];
  for (const n of numbers) {
    const prefix = SERIAL.exec(n)?.[1];
    if (prefix === undefined) { malformed.push(n); continue; }
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), n]);
  }
  const checks = [...byPrefix.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([prefix, values]) => ({
    prefix,
    count: values.length,
    duplicates: duplicatesOf(values),
    gaps: missingSerials(new Set(values.map((v) => Number(SERIAL.exec(v)?.[2] ?? 0)))),
    malformed: [],
  }));
  return malformed.length > 0 ? [...checks, { prefix: "(ogiltigt format)", count: malformed.length, duplicates: [], gaps: [], malformed }] : checks;
}

/** Brott mot serien som läsbara rader (tom = serien håller). */
export function seriesViolations(label: string, checks: readonly SeriesCheck[]): string[] {
  return checks.flatMap((c) => [
    ...(c.duplicates.length > 0 ? [`${label} ${c.prefix}: dubbla nummer ${c.duplicates.join(", ")}`] : []),
    ...(c.gaps.length > 0 ? [`${label} ${c.prefix}: luckor ${c.gaps.slice(0, 20).join(", ")}${c.gaps.length > 20 ? " …" : ""}`] : []),
    ...(c.malformed.length > 0 ? [`${label}: nummer i fel format ${c.malformed.slice(0, 10).join(", ")}`] : []),
  ]);
}

/** Förlorat och dubblerat: förväntade id:n mot det servern faktiskt har. */
export interface DeliveryCheck {
  expected: number;
  found: number;
  missing: string[];
  /** id → antal rader (> 1) — en mutation som tillämpats mer än en gång. */
  duplicated: Record<string, number>;
}

/** Jämför vad klienterna skapade med raderna servern har (en rad per förekomst). */
export function checkDelivery(expectedIds: readonly string[], serverIds: readonly string[]): DeliveryCheck {
  const counts = new Map<string, number>();
  for (const id of serverIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = [...new Set(expectedIds)].filter((id) => !counts.has(id)).sort();
  const duplicated = Object.fromEntries([...counts.entries()].filter(([, n]) => n > 1).sort(([a], [b]) => a.localeCompare(b)));
  return { expected: new Set(expectedIds).size, found: counts.size, missing, duplicated };
}

/** En rad i en jämförbar form: id + de fält som jämförs. */
export type Projected = Record<string, string | number | boolean | null>;

/** Projicera rader till `fields` (saknat fält = null) och sortera på id. */
export function project(rows: ReadonlyArray<Record<string, unknown>>, fields: readonly string[]): Projected[] {
  return rows
    .map((row) => Object.fromEntries(fields.map((f) => [f, normalize(row[f])])))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function normalize(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

/** Skillnaden mellan en klients vy och serverns för en entitet (tom = konvergerat). */
export function diffViews(label: string, client: readonly Projected[], server: readonly Projected[]): string[] {
  const byId = new Map(server.map((r) => [String(r.id), r]));
  const clientIds = new Set(client.map((r) => String(r.id)));
  const out: string[] = [];
  const onlyServer = server.filter((r) => !clientIds.has(String(r.id))).length;
  const onlyClient = client.filter((r) => !byId.has(String(r.id))).length;
  if (onlyServer > 0) out.push(`${label}: ${onlyServer} rader finns på servern men inte hos klienten`);
  if (onlyClient > 0) out.push(`${label}: ${onlyClient} rader finns hos klienten men inte på servern`);
  const differing = client.filter((r) => {
    const s = byId.get(String(r.id));
    return s !== undefined && JSON.stringify(s) !== JSON.stringify(r);
  });
  const first = differing[0];
  if (first) out.push(`${label}: ${differing.length} rader skiljer sig (t.ex. klient ${JSON.stringify(first)}, server ${JSON.stringify(byId.get(String(first.id)))})`);
  return out;
}

/** Svaren när samma mutation skickas från flera flikar samtidigt. */
export interface IdempotencyObservation {
  mutationId: string;
  /** Svarens status (accepted/rejected/conflict/rebased, eller felkod). */
  statuses: readonly string[];
  /** Hur många rader servern har för mutationens rad-id. */
  rowCount: number;
  /** Hur många sparade utfall (sync_replays) servern har; null för radkön. */
  storedOutcomes: number | null;
}

/** Brott mot idempotensen: fler/färre än en rad, flera sparade utfall, eller ett fel som inte är ett utfall. */
export function idempotencyViolations(observations: readonly IdempotencyObservation[]): string[] {
  return observations.flatMap((o) => {
    const out: string[] = [];
    if (o.rowCount !== 1) out.push(`${o.mutationId}: ${o.rowCount} rader i st.f. 1`);
    if (o.storedOutcomes !== null && o.storedOutcomes !== 1) out.push(`${o.mutationId}: ${o.storedOutcomes} sparade utfall i st.f. 1`);
    const failed = o.statuses.filter((s) => s !== "accepted" && s !== "rebased");
    if (failed.length > 0) out.push(`${o.mutationId}: ${failed.length} av ${o.statuses.length} flikar fick ${[...new Set(failed)].join("/")}`);
    return out;
  });
}
