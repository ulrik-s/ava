/**
 * LIKE-mönster ur en sökterm (#1678): `%`, `_` och `\` matchar bokstavligt.
 * Mot Postgres prövas mönstren i `repository-list-contract.test.ts`.
 */
import { describe, expect, it } from "vitest-compat";
import { containsPattern, escapeLike, prefixPattern } from "@/lib/server/db/like-pattern";

describe("like-pattern", () => {
  it("escapar jokertecknen och escape-tecknet, inget annat", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("Åsa *Öberg*")).toBe("Åsa *Öberg*");
  });

  it("innehåller och börjar med", () => {
    expect(containsPattern("50%")).toBe("%50\\%%");
    expect(prefixPattern("A_")).toBe("A\\_%");
  });
});
