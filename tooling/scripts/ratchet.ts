/**
 * Ratchet-jämförelsen: en grind börjar med dagens kända avvikelser uttryckligen
 * listade, och listan får bara krympa (#1678).
 *
 * Används av både grindtesterna som prövar betydelse och av skript under
 * `tooling/scripts/`. Den kända listan kan vara en lista med skäl per post
 * (`KnownDeviation`, skicka då `Object.keys(...)`) eller en vanlig lista med
 * nycklar, som en baslinje.
 *
 * En ny avvikelse fäller grinden, och så gör en listad avvikelse som inte
 * längre finns — då ska posten tas bort, så att ett vunnet läge inte kan
 * förloras igen (samma tanke som `lint:prune` och filstorleksspärren).
 */

/** En känd avvikelse: varför den finns kvar och issuen som ska rätta den. */
export interface KnownDeviation {
  readonly why: string;
  readonly issue: number;
}

/** Utfallet av en jämförelse: nya avvikelser och listade som inte längre finns. Båda ska vara tomma. */
export interface RatchetDiff {
  readonly added: readonly string[];
  readonly gone: readonly string[];
}

/** Jämför funna avvikelser med de kända nycklarna. Båda resultatlistorna är sorterade och utan dubbletter. */
export function ratchetDiff(found: Iterable<string>, known: Iterable<string>): RatchetDiff {
  const foundSet = new Set(found);
  const knownSet = new Set(known);
  return {
    added: [...foundSet].filter((key) => !knownSet.has(key)).sort(),
    gone: [...knownSet].filter((key) => !foundSet.has(key)).sort(),
  };
}
