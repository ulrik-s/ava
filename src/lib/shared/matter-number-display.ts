/**
 * Visningsregel för ärendenummer (#1727): den ansvariga juristens initialer
 * (`matterNumberPrefix`) framför numret när numret inte redan bär dem. Ren
 * logik, ingen I/O. Det sparade numret ändras aldrig — initialerna räknas ut
 * vid visning ur ärendets NUVARANDE ansvariga.
 */

/** Format `<PREFIX?><YYYY>-<NNNN>` — fångar (prefix, år, löpnummer). */
export const MATTER_NUMBER_RE = /^([A-ZÅÄÖ]{1,3})?(\d{4})-(\d{4,})$/;

/** Prefixdelen av ett ärendenummer: "" utan prefix, null om formatet inte följs. */
function numberPrefix(matterNumber: string): string | null {
  const m = MATTER_NUMBER_RE.exec(matterNumber);
  return m ? (m[1] ?? "") : null;
}

/**
 * Initialerna som ska visas framför `matterNumber`, eller null när bara
 * numret ska visas (ingen ansvarig/inget prefix, eller numret bär redan
 * juristens prefix).
 */
export function matterNumberInitials(matterNumber: string, lawyerPrefix: string | null | undefined): string | null {
  if (!lawyerPrefix) return null;
  return numberPrefix(matterNumber) === lawyerPrefix ? null : lawyerPrefix;
}
