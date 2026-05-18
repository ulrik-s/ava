/**
 * Helpers för time-bucketed path-derivation. DRY:ar logiken som annars
 * skulle dyka upp i varje append-projektion (events, claims,
 * time-entries, audit).
 *
 * Konvention: alla bucket-paths använder UTC och zero-padding.
 *   - day-bucket:   `<prefix>/<yyyy>/<mm>/<dd>.jsonl`
 *   - month-bucket: `<prefix>/<yyyy>/<mm>.jsonl`
 */

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `events/2026/05/18.jsonl` */
export function dayBucketPath(prefix: string, ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = pad2(ts.getUTCMonth() + 1);
  const d = pad2(ts.getUTCDate());
  return `${prefix}/${y}/${m}/${d}.jsonl`;
}

/** `time-entries/2026/05.jsonl` */
export function monthBucketPath(prefix: string, ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = pad2(ts.getUTCMonth() + 1);
  return `${prefix}/${y}/${m}.jsonl`;
}
