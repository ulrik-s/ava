/**
 * Avdragsmedvetet fakturaförslag (#397) — ren formel-modul delad mellan
 * server-routern (`billingRun.proposal`/`createAcconto`) och klient-dialogen
 * (`_billing-dialog`) så samma uträkning aldrig divergerar.
 */

/**
 * Föreslaget aconto-belopp i öre:
 *   belopp = %-sats (bips) × upparbetat värde − Σ tidigare aconton.
 * Klampas till ≥ 0 (ett aconto kan aldrig bli negativt).
 */
export function proposedAccontoOre(
  workValueOre: number,
  clientShareBips: number,
  priorAccontoSumOre: number,
): number {
  return Math.max(0, Math.round((workValueOre * clientShareBips) / 10000) - priorAccontoSumOre);
}
