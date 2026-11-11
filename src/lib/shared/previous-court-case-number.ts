/**
 * Tidigare målnummer (#1510): domstolar byter ibland målnummer, och det gamla
 * numret ska då gå att söka på. Bara ETT tidigare nummer sparas.
 */

/**
 * Vad ärendets tidigare målnummer ska bli när målnumret sparas.
 *
 * Returnerar det gamla numret när målnumret byts från ett ifyllt värde till
 * ett ANNAT ifyllt värde. Annars `undefined` = lämna tidigare målnummer orört
 * (målnumret töms, samma värde sparas igen, eller ärendet får sitt första
 * målnummer).
 */
export function previousCourtCaseNumberAfterChange(
  current: string | null | undefined,
  next: string | null | undefined,
): string | undefined {
  const from = current?.trim();
  const to = next?.trim();
  return from && to && from !== to ? from : undefined;
}
