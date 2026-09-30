/**
 * Deterministisk slump (mulberry32) för seedade egenskaps- och simuleringstester.
 * Samma seed ger samma förlopp, så ett fel återskapas med sin seed.
 */

/** Slumpkällan: `next` i [0, 1), `int` inklusive gränserna, `pick` ur en lista. */
export interface Rng {
  next: () => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T | undefined;
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
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: (xs) => xs[Math.floor(next() * xs.length)] };
}
