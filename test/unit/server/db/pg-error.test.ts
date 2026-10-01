/**
 * Postgres-fel genom inslagningarna (#1380): SQLSTATE hittas på det innersta
 * felet i orsakskedjan.
 */
import { describe, expect, it } from "vitest-compat";
import { causeChain, deterministicPgCause, isDeterministicSqlState, isUniqueViolation, sqlStateOf } from "@/lib/server/db/pg-error";

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

  it("isDeterministicSqlState: klass 22 och 23 är deterministiska, andra inte (#1399)", () => {
    expect(isDeterministicSqlState(pgError("23505"))).toBe(true);
    expect(isDeterministicSqlState(pgError("23502"))).toBe(true);
    expect(isDeterministicSqlState(pgError("22P02"))).toBe(true);
    expect(isDeterministicSqlState(pgError("40001"))).toBe(false);
    expect(isDeterministicSqlState(pgError("08006"))).toBe(false);
    expect(isDeterministicSqlState(new Error("nätet"))).toBe(false);
  });

  it("deterministicPgCause ger det inslagna data-/integritetsfelet, annars undefined", () => {
    const inner = pgError("23502");
    expect(deterministicPgCause(new Error("Failed query", { cause: inner }))).toBe(inner);
    expect(deterministicPgCause(new Error("Failed query", { cause: pgError("57P01") }))).toBeUndefined();
    expect(deterministicPgCause("sträng")).toBeUndefined();
  });
});
