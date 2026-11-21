/**
 * Expand eller contract (#1770): kan förra versionens kod köra mot schemat
 * efter migrationen? Bara då är en automatisk rollback av servern säker —
 * databasen backas aldrig, användarnas data ligger kvar.
 *
 * - **expand**: lägger till (tabeller, nullbara kolumner, kolumner med
 *   default, index, enum-värden) och fyller i data. Den gamla koden märker
 *   inget.
 * - **contract**: tar bort, döper om, byter typ eller skärper (NOT NULL,
 *   constraints, unika index) på det som redan finns. Den gamla koden kan gå
 *   sönder, så deployen backar inte servern automatiskt.
 *
 * Varje migration från 0052 börjar med `-- kind: expand` eller
 * `-- kind: contract`. `db:check-migrations` fäller en expand-migration med
 * destruktiv SQL, och `deploy-prod.sh` läser vilka som är väntande.
 */

/** Migrationens art. */
export type MigrationKind = "expand" | "contract";

/** Första migrationen som måste vara märkt; de äldre är redan körda överallt. */
export const CLASSIFIED_FROM = 52;

const KIND = /^\s*--\s*kind:\s*(expand|contract)\b/i;

/** Märkningen på första raden, eller null. */
export function declaredKind(sql: string): MigrationKind | null {
  const kind = KIND.exec(sql.split("\n", 1)[0] ?? "")?.[1]?.toLowerCase();
  return kind === "expand" || kind === "contract" ? kind : null;
}

/** SQL:en utan kommentarer. */
const uncommented = (sql: string): string => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** Dollar-citerade kroppar (`$$ … $$`, `$tag$ … $tag$`) ersatta, så att deras `;` inte delar satser. */
const withoutBodies = (sql: string): string => sql.replace(/(\$\w*\$)[\s\S]*?\1/g, "$$$$body$$$$");

/** Procedurkod som kör SQL vi inte kan läsa: DO-block och dynamisk EXECUTE. */
function opaqueCode(sql: string): string[] {
  const text = uncommented(sql);
  return /\bDO\s+(?:LANGUAGE\s+\w+\s+)?\$\w*\$/i.test(text) || /\bEXECUTE\s+(?:format\s*\(|'|\$)/i.test(text)
    ? ["innehåller procedurkod (DO-block eller dynamisk EXECUTE) som inte kan granskas automatiskt"]
    : [];
}

/** SQL:en utan kommentarer och funktionskroppar, en sats per element. */
function statements(sql: string): string[] {
  return withoutBodies(uncommented(sql))
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s !== "");
}

const ident = (raw: string): string => raw.replace(/"/g, "").split(".").at(-1)?.toLowerCase() ?? "";

/** Tabeller som skapas i samma migration: allt på dem är nytt och ofarligt. */
function createdTables(stmts: readonly string[]): Set<string> {
  return new Set(stmts.flatMap((s) => {
    const m = /^CREATE TABLE (?:IF NOT EXISTS )?("?[\w.]+"?(?:\."?\w+"?)?)/i.exec(s);
    return m?.[1] ? [ident(m[1])] : [];
  }));
}

/** Delsatser i en ALTER TABLE som den gamla koden kan gå sönder av. */
const ALTER_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDROP (?:COLUMN )?(?!CONSTRAINT\b|NOT NULL\b|DEFAULT\b|INDEX\b)"?\w+/i, "tar bort en kolumn"],
  [/\bALTER (?:COLUMN )?"?\w+"? DROP DEFAULT\b/i, "tar bort ett default"],
  [/\bRENAME\b/i, "döper om"],
  [/\bALTER (?:COLUMN )?"?\w+"? (?:SET DATA )?TYPE\b/i, "byter typ"],
  [/\bSET NOT NULL\b/i, "skärper till NOT NULL"],
  [/\bADD CONSTRAINT\b|\bADD (?:UNIQUE|CHECK|FOREIGN KEY|PRIMARY KEY)\b/i, "lägger till en constraint"],
];

/** En ADD COLUMN med NOT NULL men utan DEFAULT: den gamla koden kan inte infoga rader. */
function addsRequiredColumn(stmt: string): boolean {
  return stmt.split(/,(?![^(]*\))/).some((clause) =>
    /\bADD (?:COLUMN )?/i.test(clause) && /\bNOT NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause) && !/\bGENERATED\b/i.test(clause));
}

function alterProblems(stmt: string, created: ReadonlySet<string>): string[] {
  const table = /^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?("?[\w.]+"?(?:\."?\w+"?)?)/i.exec(stmt)?.[1];
  if (table === undefined || created.has(ident(table))) return [];
  const found = ALTER_RULES.filter(([re]) => re.test(stmt)).map(([, why]) => why);
  return addsRequiredColumn(stmt) ? [...found, "lägger till en NOT NULL-kolumn utan default"] : found;
}

function statementProblems(stmt: string, created: ReadonlySet<string>): string[] {
  if (/^ALTER TABLE\b/i.test(stmt)) return alterProblems(stmt, created);
  if (/^DROP (?:TABLE|TYPE|SCHEMA|VIEW|MATERIALIZED VIEW|SEQUENCE|FUNCTION)\b/i.test(stmt)) return ["tar bort ett objekt"];
  if (/^ALTER TYPE\b.*\b(?:RENAME|DROP)\b/i.test(stmt)) return ["ändrar en enum"];
  if (/^(?:DELETE FROM|TRUNCATE)\b/i.test(stmt)) return ["tar bort data"];
  const unique = /^CREATE UNIQUE INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?\S+ ON (?:ONLY )?("?[\w.]+"?(?:\."?\w+"?)?)/i.exec(stmt)?.[1];
  return unique !== undefined && !created.has(ident(unique)) ? ["lägger till ett unikt index"] : [];
}

/** De satser som gör migrationen till contract, med varför. Tomt = expand. */
export function destructiveStatements(sql: string): string[] {
  const stmts = statements(sql);
  const created = createdTables(stmts);
  const found = stmts.flatMap((s) => statementProblems(s, created).map((why) => `${why}: ${s.length > 120 ? `${s.slice(0, 117)}...` : s}`));
  return [...opaqueCode(sql), ...found];
}

/** Migrationens nummer ur filnamnet (`0052_x.sql` → 52), eller null. */
export const migrationNumber = (filename: string): number | null => {
  const n = /^(\d{4})_/.exec(filename)?.[1];
  return n === undefined ? null : Number(n);
};

/** Felen i en migrations märkning: saknad märkning, eller destruktiv SQL i en expand. */
export function kindProblems(filename: string, sql: string): string[] {
  const n = migrationNumber(filename);
  if (n === null || n < CLASSIFIED_FROM) return [];
  const kind = declaredKind(sql);
  if (kind === null) return [`${filename}: saknar \`-- kind: expand\` eller \`-- kind: contract\` på första raden`];
  if (kind === "contract") return [];
  return destructiveStatements(sql).map((d) => `${filename}: märkt expand men ${d} — märk den \`-- kind: contract\` eller gör den bakåtkompatibel`);
}

/**
 * Arten för en väntande migration vid deploy: märkningen, och en omärkt
 * räknas som contract (ingen automatisk rollback när vi inte vet).
 */
export const deployKind = (sql: string): MigrationKind => declaredKind(sql) ?? "contract";
