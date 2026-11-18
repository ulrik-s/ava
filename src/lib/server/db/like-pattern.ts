/**
 * LIKE/ILIKE-mönster ur en sökterm (#1678). `\`, `%` och `_` escapas, så att
 * termen matchar bokstavligt — som `contains`/`startsWith` i minnesrepot. Utan
 * escape hittade sökningen "100%" allt som innehöll "100", och prefixet "A_"
 * matchade "AB". `\` är Postgres standard-escape för LIKE.
 */

/** Termen med LIKE:s jokertecken (och escape-tecknet) escapade. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/** Mönstret för "värdet innehåller termen". */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** Mönstret för "värdet börjar med termen". */
export function prefixPattern(term: string): string {
  return `${escapeLike(term)}%`;
}
