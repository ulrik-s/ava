/**
 * Svensk ordning i Drizzle-frågor (#1917): `swedishOrder` lägger ICU-kollationen
 * på kolumnen. Ordningen mot riktig Postgres prövas i `repository-list-contract.test.ts`.
 */
import { asc } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest-compat";
import { contacts } from "@/lib/server/db/schema";
import { SWEDISH_COLLATION, swedishOrder } from "@/lib/server/db/swedish-order";

const dialect = new PgDialect();

describe("swedishOrder", () => {
  it("är Postgres fördefinierade svenska ICU-kollation", () => {
    expect(SWEDISH_COLLATION).toBe("sv-x-icu");
  });

  it("ger kolumnen med collate och kollationens namn som identifierare", () => {
    const { sql } = dialect.sqlToQuery(asc(swedishOrder(contacts.name)).getSQL());
    expect(sql).toBe(`"contacts"."name" collate "${SWEDISH_COLLATION}" asc`);
  });
});
