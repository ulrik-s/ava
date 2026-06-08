/**
 * Minimal semver-jämförelse för self-update. Vi behöver bara avgöra om
 * en release är nyare än den inbyggda versionen, så vi parsar major.
 * minor.patch och struntar i pre-release-suffix (releaser taggas rent).
 */

export type SemverTriple = readonly [number, number, number];

/** Plocka X.Y.Z ur en tagg ("helper-v1.2.3", "v1.2.3", "1.2.3"). null om ogiltig. */
export function parseSemver(tag: string): SemverTriple | null {
  const m = tag.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 om a<b, 0 om lika, 1 om a>b. */
export function compareSemver(a: SemverTriple, b: SemverTriple): number {
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/** true om `candidate`-taggen är strikt nyare än `current`-taggen. */
export function isNewer(candidate: string, current: string): boolean {
  const c = parseSemver(candidate);
  const cur = parseSemver(current);
  if (c === null || cur === null) return false;
  return compareSemver(c, cur) > 0;
}
