/**
 * Deterministisk slump (mulberry32) för lasttestet (#1366): samma `LOAD_SEED`
 * ger samma blandning av handlingar, så en körning går att upprepa.
 */

/** Slumpkällan: `next` i [0, 1), `int` inklusive gränserna, `pick` ur en lista, `weighted` efter vikt. */
export interface Rng {
  next: () => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T | undefined;
  /** Exponentialfördelad väntan med medelvärdet `mean` (Poisson-ankomster), högst 5 × medel. */
  exp: (mean: number) => number;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    exp: (mean) => Math.min(-Math.log(1 - next()) * mean, 5 * mean),
  };
}

/** Välj en post efter vikt (`[vikt, värde]`). Tom lista → undefined. */
export function weighted<T>(r: Rng, items: ReadonlyArray<readonly [number, T]>): T | undefined {
  const total = items.reduce((sum, [w]) => sum + w, 0);
  let x = r.next() * total;
  for (const [w, value] of items) {
    if ((x -= w) < 0) return value;
  }
  return items[items.length - 1]?.[1];
}
