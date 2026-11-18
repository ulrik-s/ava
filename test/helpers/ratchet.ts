/**
 * Ratchet-listor för grindarna som prövar betydelse (#1678): en grind börjar
 * med dagens kända avvikelser uttryckligen listade, och listan får bara krympa.
 *
 * Varje post säger varför avvikelsen finns kvar och vilken issue som ska rätta
 * den. En ny avvikelse fäller grinden, och så gör en listad avvikelse som inte
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

/** Jämför funna avvikelser med den kända listan. */
export function ratchetDiff(found: Iterable<string>, known: Readonly<Record<string, KnownDeviation>>): RatchetDiff {
  const foundSet = new Set(found);
  return {
    added: [...foundSet].filter((key) => !Object.hasOwn(known, key)).sort(),
    gone: Object.keys(known).filter((key) => !foundSet.has(key)).sort(),
  };
}
