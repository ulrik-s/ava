/**
 * Migrationskontrollen (#1251): unika nummer, och SQL:en matchar Drizzle-schemat.
 */
import { integer, pgTable, serial, text, varchar } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest-compat";
import {
  checkMigrations, duplicateMigrationNumbers, expectedColumns, migratedColumns, misnamedMigrations, normalizeType, schemaDrift,
  type ColumnShape,
} from "../../../tooling/scripts/check-migrations";

const cols = (entries: Array<[string, ColumnShape]>): Map<string, ColumnShape> => new Map(entries);

describe("migrationernas namn och nummer", () => {
  it("formen är NNNN_namn.sql", () => {
    expect(misnamedMigrations(["0001_a.sql", "1_b.sql", "0002-c.sql", "0003_Stor.sql"])).toEqual(["1_b.sql", "0002-c.sql", "0003_Stor.sql"]);
  });

  it("två migrationer med samma nummer fälls, med båda filerna", () => {
    expect(duplicateMigrationNumbers(["0027_a.sql", "0027_b.sql", "0028_c.sql", "fel.sql"])).toEqual(["0027: 0027_a.sql, 0027_b.sql"]);
  });

  it("dagens migrationer: inga fel alls — de matchar schemat", async () => {
    expect(await checkMigrations()).toEqual([]);
  });

  it("namnfel rapporteras innan databasen rörs", async () => {
    const problems = await checkMigrations([
      { filename: "0001_a.sql", sql: "SELECT 1" }, { filename: "0001_b.sql", sql: "SELECT 1" }, { filename: "x.sql", sql: "SELECT 1" },
    ]);
    expect(problems).toEqual(["felaktigt namn: x.sql (förväntat NNNN_namn.sql)", "samma nummer: 0001: 0001_a.sql, 0001_b.sql"]);
  });
});

describe("normalizeType", () => {
  it("Drizzles typer i information_schemas namn", () => {
    expect(["bigserial", "serial", "smallserial", "varchar(255)", "text[]", "numeric(10, 2)", "uuid"].map(normalizeType))
      .toEqual(["bigint", "integer", "smallint", "character varying", "ARRAY", "numeric", "uuid"]);
  });
});

describe("schemaDrift", () => {
  const want = cols([["t.a", { type: "bigint", notNull: true }], ["t.b", { type: "text", notNull: false }]]);

  it("samma form → ingen skillnad", () => {
    expect(schemaDrift(want, want)).toEqual([]);
  });

  it("saknad kolumn, fel typ och fel nullbarhet åt båda hållen", () => {
    expect(schemaDrift(want, cols([["t.a", { type: "integer", notNull: true }]]))).toEqual([
      "t.a: typ integer i databasen, bigint i schemat", "t.b: saknas i databasen (text)",
    ]);
    expect(schemaDrift(want, cols([["t.a", { type: "bigint", notNull: false }], ["t.b", { type: "text", notNull: true }]]))).toEqual([
      "t.a: nullbar i databasen, NOT NULL i schemat", "t.b: NOT NULL i databasen, nullbar i schemat",
    ]);
  });

  it("en kolumn bara databasen har rapporteras, utom i ignorerade tabeller", () => {
    const actual = cols([...want, ["t.c", { type: "text", notNull: false }], ["schema_migrations.filename", { type: "text", notNull: true }]]);
    expect(schemaDrift(want, actual, new Set(["schema_migrations"]))).toEqual(["t.c: finns i databasen men inte i schemat"]);
  });
});

describe("kolumnerna på båda sidor", () => {
  it("schemat: tabellens kolumner med typ och NOT NULL; annat än tabeller ignoreras", () => {
    const t = pgTable("things", { id: serial("id").primaryKey(), name: varchar("name", { length: 40 }).notNull(), n: integer("n"), note: text("note") });
    expect(expectedColumns({ t, notATable: 42 })).toEqual(cols([
      ["things.id", { type: "integer", notNull: true }], ["things.name", { type: "character varying", notNull: true }],
      ["things.n", { type: "integer", notNull: false }], ["things.note", { type: "text", notNull: false }],
    ]));
  });

  it("databasen: kolumnerna efter migrationerna", async () => {
    const actual = await migratedColumns([{ filename: "0001_a.sql", sql: "CREATE TABLE things (id bigint NOT NULL, note text)" }]);
    expect(actual).toEqual(cols([["things.id", { type: "bigint", notNull: true }], ["things.note", { type: "text", notNull: false }]]));
  });
});
