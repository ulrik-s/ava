/**
 * Postgres-fel genom inslagningarna (#1380): SQLSTATE hittas på det innersta
 * felet i orsakskedjan.
 */
import { describe, expect, it } from "vitest-compat";
import { causeChain, isUniqueViolation, sqlStateOf } from "@/lib/server/db/pg-error";

function pgError(code: string): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), { code });
}

describe("pg-error", () => {
  it("causeChain följer cause, ytterst först, och slutar vid icke-Error", () => {
    const inner = pgError("23505");
    const outer = new Error("Failed query: insert …", { cause: inner });
    expect(causeChain(outer)).toEqual([outer, inner]);
    expect(causeChain("sträng")).toEqual([]);
  });

  it("causeChain är begränsad i djup (cykliska orsaker hänger inte)", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(causeChain(a)).toHaveLength(5);
  });

  it("sqlStateOf läser bara en sträng-kod på ett Error", () => {
    expect(sqlStateOf(pgError("22P02"))).toBe("22P02");
    expect(sqlStateOf(Object.assign(new Error("x"), { code: 23505 }))).toBeUndefined();
    expect(sqlStateOf({ code: "23505" })).toBeUndefined();
    expect(sqlStateOf(new Error("x"))).toBeUndefined();
  });

  it("isUniqueViolation hittar 23505 även inslaget, men inte andra koder", () => {
    expect(isUniqueViolation(new Error("Failed query", { cause: pgError("23505") }))).toBe(true);
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: pgError("23503") }))).toBe(false);
    expect(isUniqueViolation(new Error("nätet"))).toBe(false);
  });
});
