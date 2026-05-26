/**
 * Enkel bigram-Jaccard-similaritet — drop-in-ersättning för PostgreSQL:s
 * `pg_trgm.similarity()` i pure-git-modellen.
 *
 * - Normalisering: lowercase + collapse whitespace + strippa diakritik
 *   (å→a, ö→o osv).
 * - Bigrams: överlappande 2-tecken-sliding-window. För strängar < 2 tecken
 *   används singletons.
 * - Score: |A ∩ B| / |A ∪ B| (Jaccard). 0 = inget gemensamt, 1 = identiska.
 *
 * Inte exakt samma som Postgres' trigram-similaritet, men ger samma
 * pragmatiska "fuzzy match"-känsla för svenska namn. Tröskel 0.3 i
 * jävskontrollen översätter ~motsvarande till 0.4 här (mer permissivt).
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // ta bort diakritik
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s.length === 1) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

/**
 * Jaccard-similaritet mellan två strängars bigram-set efter normalisering.
 * Returnerar 0 för tomma strängar.
 */
export function similarity(a: string, b: string): number {
  const A = bigrams(normalize(a));
  const B = bigrams(normalize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const g of A) if (B.has(g)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
