/**
 * Löpnummerserier (#1350) — fakturor `F-YYYY-NNNN`, kostnadsräkningar
 * `KR-YYYY-NNNN`, ärenden `<PREFIX>YYYY-NNNN`. Löpnumret paddas till minst
 * fyra siffror och växer därefter (`F-2026-10000`).
 *
 * Det högsta numret jämförs NUMERISKT, aldrig som text: textuellt är
 * `F-2026-9999` större än `F-2026-10000`, så efter 9999 räknades samma
 * nummer fram igen — krock på primärnyckeln och omförsök i all evighet.
 */

import { MATTER_NUMBER_RE } from "@/lib/shared/matter-number-display";

/** Minsta antal siffror i löpnumret. */
const MIN_DIGITS = 4;

/** `prefix` + löpnumret, paddat till minst fyra siffror. */
export function formatSeriesNumber(prefix: string, seq: number): string {
  return `${prefix}${seq.toString().padStart(MIN_DIGITS, "0")}`;
}

/** Löpnumret i `value` om det hör till serien `prefix` — annars 0. */
export function seriesSeq(prefix: string, value: string | null | undefined): number {
  if (!value?.startsWith(prefix)) return 0;
  const rest = value.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : 0;
}

/** Nästa nummer i serien, efter det numeriskt högsta bland `values`. */
export function nextSeriesNumber(prefix: string, values: ReadonlyArray<string | null | undefined>): string {
  const max = values.reduce((mx, v) => Math.max(mx, seriesSeq(prefix, v)), 0);
  return formatSeriesNumber(prefix, max + 1);
}

/** Reguljärt uttryck (Postgres `~`) för exakt ett nummer i serien: prefixet och bara siffror. */
export function seriesPattern(prefix: string): string {
  return `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[0-9]+$`;
}

/** Löpnumret i ett ärendenummer OM det avser `year`, annars 0. */
export function seqForYear(matterNumber: string, year: number): number {
  const m = MATTER_NUMBER_RE.exec(matterNumber);
  if (!m || Number(m[2]) !== year) return 0;
  return parseInt(m[3] ?? "0", 10);
}

/** Högsta löpnumret för `year` bland en uppsättning ärenden. */
export function maxSeq(matters: ReadonlyArray<{ matterNumber: string }>, year: number): number {
  return matters.reduce((mx, m) => Math.max(mx, seqForYear(m.matterNumber, year)), 0);
}
