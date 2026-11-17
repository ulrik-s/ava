/**
 * Jävmärkningen efter en jävskontroll: "N träff(ar) — bedöm om jäv föreligger"
 * eller "Inga träffar". Delas av jävskontrollsidan och den sammanslagna
 * sökningen i ärendelistan (#1642).
 */

export function ConflictMatchBadge({ matchCount }: { matchCount: number }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
      matchCount > 0 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
    }`}>
      {matchCount > 0 ? `${matchCount} träff(ar) — bedöm om jäv föreligger` : "Inga träffar"}
    </span>
  );
}
