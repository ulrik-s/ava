/**
 * Drizzle ↔ zod-paritet (#1678): samma kolumn betyder samma sak i Postgres
 * (`schema.ts`) och i zod-schemat som LocalStore, seeden och routrarna läser
 * med (`shared/schemas`). Strukturgrindarna såg inte att `taxa_has_f_tax` hade
 * DEFAULT false medan koden antog true (#1675) — den här grinden ser det.
 *
 * Per kolumn och fält prövas:
 *   - **standardvärdet**: en kolumn med ett standardvärde ska ha samma värde i
 *     zod, så länge zod tillåter att fältet saknas. Kräver zod fältet uppstår
 *     ingen skillnad (en validerad rad bär alltid värdet).
 *   - **nullbarheten**: NOT NULL i databasen men null godtas av zod (raden går
 *     inte att spara), eller null i databasen men inte i zod (raden går inte att läsa).
 *   - **enum-värdena** (typnivå, `tsc`): en text-kolumn med `$type<…>` och zod-
 *     fältet har samma strängliteraler. Drizzle har ingen enum i körtid.
 *   - **fälten**: en kolumn utan zod-fält, eller ett zod-fält utan kolumn.
 *     Reconcile-kolumnerna (ADR 0017) är undantagna: zod `.passthrough()` bär dem.
 *   - **kodens reservvärden**: `x.fält ?? true/false` i `src/` där fältet är en
 *     boolesk kolumn med motsatt standardvärde. Rader som skapas i minnesrepot
 *     valideras inte, så där är reservvärdet det verkliga standardvärdet.
 *
 * Varje lista är en ratchet (`test/helpers/ratchet.ts`): dagens avvikelser står
 * med issue, nya fäller testet och en rättad avvikelse måste strykas ur listan.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getTableColumns, is, SQL, Table, type InferSelectModel } from "drizzle-orm";
import { describe, expect, it } from "vitest-compat";
import type { z } from "zod";
import * as db from "@/lib/server/db/schema";
import {
  accontoDeductionSchema, billingRunSchema, calendarEventSchema, conflictCheckSchema, contactSchema,
  documentAnalysisSuggestionSchema, documentFolderSchema, documentPartSchema, documentSchema,
  documentTemplateSchema, ENTITY_REGISTRY, expectedReceivableSchema, expenseSchema, invoiceDispatchSchema,
  invoiceSchema, matterContactSchema, matterEventSuggestionSchema, matterSchema, officeSchema,
  organizationSchema, paymentPlanReminderSchema, paymentPlanSchema, paymentSchema, serviceNoteSchema,
  taskSchema, timeEntrySchema, userSchema, writeOffSchema,
} from "@/lib/shared/schemas";
import { orgPreferenceSchema, userPreferenceSchema } from "@/lib/shared/schemas/preference";
import { type KnownDeviation, ratchetDiff } from "../../../helpers/ratchet";

/**
 * Tabell ↔ entitetsschema. Nyckeln är entitetens `sourceKey` (= tabellens
 * export i `schema.ts`); täckningen mot ENTITY_REGISTRY prövas nedan.
 */
const PAIRS = {
  organizations: { table: db.organizations, schema: organizationSchema },
  offices: { table: db.offices, schema: officeSchema },
  users: { table: db.users, schema: userSchema },
  contacts: { table: db.contacts, schema: contactSchema },
  matters: { table: db.matters, schema: matterSchema },
  matterContacts: { table: db.matterContacts, schema: matterContactSchema },
  documents: { table: db.documents, schema: documentSchema },
  documentFolders: { table: db.documentFolders, schema: documentFolderSchema },
  documentParts: { table: db.documentParts, schema: documentPartSchema },
  documentAnalysisSuggestions: { table: db.documentAnalysisSuggestions, schema: documentAnalysisSuggestionSchema },
  matterEventSuggestions: { table: db.matterEventSuggestions, schema: matterEventSuggestionSchema },
  timeEntries: { table: db.timeEntries, schema: timeEntrySchema },
  expenses: { table: db.expenses, schema: expenseSchema },
  invoices: { table: db.invoices, schema: invoiceSchema },
  payments: { table: db.payments, schema: paymentSchema },
  paymentPlans: { table: db.paymentPlans, schema: paymentPlanSchema },
  paymentPlanReminders: { table: db.paymentPlanReminders, schema: paymentPlanReminderSchema },
  accontoDeductions: { table: db.accontoDeductions, schema: accontoDeductionSchema },
  billingRuns: { table: db.billingRuns, schema: billingRunSchema },
  writeOffs: { table: db.writeOffs, schema: writeOffSchema },
  invoiceDispatches: { table: db.invoiceDispatches, schema: invoiceDispatchSchema },
  expectedReceivables: { table: db.expectedReceivables, schema: expectedReceivableSchema },
  documentTemplates: { table: db.documentTemplates, schema: documentTemplateSchema },
  conflictChecks: { table: db.conflictChecks, schema: conflictCheckSchema },
  calendarEvents: { table: db.calendarEvents, schema: calendarEventSchema },
  tasks: { table: db.tasks, schema: taskSchema },
  serviceNotes: { table: db.serviceNotes, schema: serviceNoteSchema },
  userPreferences: { table: db.userPreferences, schema: userPreferenceSchema },
  orgPreferences: { table: db.orgPreferences, schema: orgPreferenceSchema },
};

/** Reconcile-kolumnerna (ADR 0017) finns på alla tabeller; zod `.passthrough()` bär dem. */
const RECONCILE_COLUMNS: ReadonlySet<string> = new Set(["id", "createdAt", "updatedAt", "version", "deletedAt"]);

// ─── Standardvärde, nullbarhet och fält (körtid) ─────────────────────────────

/** Kända avvikelser mellan kolumn och zod-fält: `tabell.fält:slag`. */
const KNOWN_COLUMN_DEVIATIONS: Readonly<Record<string, KnownDeviation>> = {
  "matters.taxaHasFTax:null": {
    why: "Kolumnen är NOT NULL DEFAULT true (#1675), men zod tar emot null. Ett ärende med null sparas inte i Postgres.",
    issue: 1694,
  },
  "matters.taxaHasFTax:standardvärde": {
    why: "Databasen ger true, zod saknar standardvärde. Koden kompenserar med `taxaHasFTax ?? true`, som dolde #1675.",
    issue: 1694,
  },
};

type Column = ReturnType<typeof getTableColumns>[string];

/** Standardvärdet i zod: värdet när fältet saknas, `undefined` om det får saknas utan värde, `required` om det krävs. */
function zodDefault(field: z.ZodType): { value: unknown } | "required" {
  const parsed = field.safeParse(undefined);
  return parsed.success ? { value: parsed.data } : "required";
}

/** Ett bokstavligt standardvärde i databasen (inte `now()` eller liknande), annars `undefined`. */
function literalDefault(column: Column): { value: unknown } | undefined {
  return column.default === undefined || is(column.default, SQL) ? undefined : { value: column.default };
}

function nullDeviates(column: Column, field: z.ZodType): boolean {
  return column.notNull === field.safeParse(null).success;
}

/**
 * Skiljer standardvärdet? Ett bokstavligt standardvärde i databasen ska finnas i
 * zod när fältet får saknas; ett standardvärde i zod ska finnas i databasen.
 * SQL-uttryck (`now()`) och fält som zod kräver prövas inte.
 */
function defaultDeviates(column: Column, field: z.ZodType): boolean {
  const inZod = zodDefault(field);
  if (inZod === "required") return false;
  const inDb = literalDefault(column);
  if (inDb) return !isDeepStrictEqual(inDb.value, inZod.value);
  return inZod.value !== undefined && !column.hasDefault;
}

function fieldDeviations(name: string, column: Column, field: z.ZodType): string[] {
  return [
    nullDeviates(column, field) ? `${name}:null` : null,
    defaultDeviates(column, field) ? `${name}:standardvärde` : null,
  ].filter((d) => d !== null);
}

type Shape = Readonly<Record<string, z.ZodType>>;

function columnFindings(table: string, name: string, column: Column, field: z.ZodType | undefined): string[] {
  if (field) return fieldDeviations(`${table}.${name}`, column, field);
  return RECONCILE_COLUMNS.has(name) ? [] : [`${table}.${name}:saknas i zod`];
}

function pairDeviations(key: string, table: Table, shape: Shape): string[] {
  const columns = getTableColumns(table);
  const fromColumns = Object.entries(columns).flatMap(([name, column]) => columnFindings(key, name, column, shape[name]));
  const fromFields = Object.keys(shape).filter((name) => !Object.hasOwn(columns, name)).map((name) => `${key}.${name}:saknas i databasen`);
  return [...fromColumns, ...fromFields];
}

function columnDeviations(): string[] {
  return Object.entries(PAIRS).flatMap(([key, { table, schema }]) => pairDeviations(key, table, schema.shape));
}

// ─── Enum-värden (typnivå) ───────────────────────────────────────────────────

/** Samma typ (ömsesidigt tilldelbara) — räcker för unioner av strängliteraler. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** En union av strängliteraler — inte `string`, inte ett brandat id. */
type IsLiteralUnion<T> = [T] extends [never] ? false
  : [T] extends [string] ? (string extends T ? false : [Exclude<keyof T, keyof string>] extends [never] ? true : false)
  : false;
type ShapeOf<S> = S extends z.ZodObject<infer Shape> ? Shape : never;
type FieldType<S, K> = K extends keyof ShapeOf<S> ? (ShapeOf<S>[K] extends z.ZodType ? NonNullable<z.output<ShapeOf<S>[K]>> : never) : never;
type Get<O, K> = K extends keyof O ? O[K] : never;
type ColumnType<T extends Table, K> = NonNullable<Get<InferSelectModel<T>, K>>;
type SharedKey<T extends Table, S> = keyof InferSelectModel<T> & keyof ShapeOf<S> & string;

/** Fälten där kolumnens eller zod-fältets typ är strängliteraler och de skiljer sig. */
type EnumDrift<T extends Table, S> = {
  [K in SharedKey<T, S>]: IsLiteralUnion<ColumnType<T, K>> extends true
    ? (Equal<ColumnType<T, K>, FieldType<S, K>> extends true ? never : K)
    : (IsLiteralUnion<FieldType<S, K>> extends true ? K : never)
}[SharedKey<T, S>];

type Pairs = typeof PAIRS;
/** Alla enum-avvikelser som `tabell.fält`. */
type AllEnumDrift = {
  [K in keyof Pairs]: `${K}.${EnumDrift<Pairs[K]["table"], Pairs[K]["schema"]>}`
}[keyof Pairs];

/**
 * Kända enum-avvikelser (`tabell.fält`). Tom sedan `time_entries.kind` fick
 * zod-enumens typ. En post kräver att nyckeln också står i typen (`never` nu).
 */
const KNOWN_ENUM_DRIFT: Readonly<Record<never, KnownDeviation>> = {};
type KnownEnumDrift = keyof typeof KNOWN_ENUM_DRIFT;
type NewEnumDrift = Exclude<AllEnumDrift, KnownEnumDrift>;
type GoneEnumDrift = Exclude<KnownEnumDrift, AllEnumDrift>;

// Typkontrollen (`bun run typecheck`) fäller här: felet namnger fältet.
const noNewEnumDrift: [NewEnumDrift] extends [never] ? true : NewEnumDrift = true;
const noGoneEnumDrift: [GoneEnumDrift] extends [never] ? true : GoneEnumDrift = true;

// ─── Kodens reservvärden (`?? true` / `?? false`) ────────────────────────────

/** Kända reservvärden som motsäger databasen: `fil: fält ?? värde (antal)`. */
const KNOWN_FALLBACKS: Readonly<Record<string, KnownDeviation>> = {
  "src/app/matters/[id]/_expense-section.tsx: vatIncluded ?? true (2)": {
    why: "Utläggslistan läser ett utlägg utan fältet som brutto; databasen och zod säger netto.",
    issue: 1455,
  },
  "src/lib/shared/kostnadsrakning.ts: vatIncluded ?? true (1)": {
    why: "Kostnadsräkningens dokument läser ett utlägg utan fältet som brutto; yrkandet räknar netto.",
    issue: 1455,
  },
  "src/lib/shared/kostnadsrakning.ts: isTaxeArende ?? true (4)": {
    why: "Kostnadsräkningen antar taxa när uppgiften saknas; ärendets standardvärde är false.",
    issue: 1695,
  },
};

const FALLBACK = /\.(\w+)\s*\?\?\s*(true|false)\b/g;

/** Booleska kolumners standardvärde per fältnamn, över alla tabeller. Tvetydiga namn utelämnas. */
function booleanDefaults(): Map<string, boolean> {
  const seen = new Map<string, Set<boolean>>();
  for (const table of Object.values(db).filter((v) => is(v, Table))) {
    for (const [name, column] of Object.entries(getTableColumns(table))) {
      if (typeof column.default === "boolean") seen.set(name, (seen.get(name) ?? new Set<boolean>()).add(column.default));
    }
  }
  return new Map([...seen].flatMap(([name, values]) => (values.size === 1 ? [[name, values.has(true)] as const] : [])));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join(dir, path));
}

/** Reservvärden i en fil som motsäger kolumnens standardvärde, räknade per fält. */
function fileFallbacks(file: string, defaults: ReadonlyMap<string, boolean>): string[] {
  const counts = new Map<string, number>();
  for (const [, field = "", value = ""] of readFileSync(file, "utf8").matchAll(FALLBACK)) {
    const inDb = defaults.get(field);
    const what = `${field} ?? ${value}`;
    if (inDb !== undefined && inDb !== (value === "true")) counts.set(what, (counts.get(what) ?? 0) + 1);
  }
  return [...counts].map(([what, n]) => `${file}: ${what} (${n})`);
}

function fallbackDeviations(): string[] {
  const defaults = booleanDefaults();
  return sourceFiles("src").flatMap((file) => fileFallbacks(file, defaults));
}

// ─── Testerna ────────────────────────────────────────────────────────────────

describe("Drizzle ↔ zod-paritet (#1678)", () => {
  it("varje entitet i ENTITY_REGISTRY har sin tabell och sitt schema i kartan", () => {
    const pairs: Readonly<Record<string, { table: Table; schema: z.ZodType }>> = PAIRS;
    const exports = new Map<string, unknown>(Object.entries(db));
    const entries = Object.values(ENTITY_REGISTRY);
    expect(entries.map((entry) => entry.sourceKey).sort()).toEqual(Object.keys(PAIRS).sort());
    for (const { sourceKey, schema } of entries) {
      expect(pairs[sourceKey]?.schema).toBe(schema);
      expect(pairs[sourceKey]?.table).toBe(exports.get(sourceKey));
    }
  });

  it("standardvärde, nullbarhet och fält stämmer — utom de listade", () => {
    expect(ratchetDiff(columnDeviations(), KNOWN_COLUMN_DEVIATIONS)).toEqual({ added: [], gone: [] });
  });

  it("enum-värdena stämmer (typnivå: `bun run typecheck` fäller på en ny avvikelse)", () => {
    expect([noNewEnumDrift, noGoneEnumDrift]).toEqual([true, true]);
  });

  it("varje känd avvikelse har ett skäl och en issue", () => {
    const lists: ReadonlyArray<Readonly<Record<string, KnownDeviation>>> = [KNOWN_COLUMN_DEVIATIONS, KNOWN_ENUM_DRIFT, KNOWN_FALLBACKS];
    const known = lists.flatMap((list) => Object.values(list));
    for (const { why, issue } of known) expect([why.length > 0, issue > 0]).toEqual([true, true]);
  });

  it("kodens `?? true`/`?? false` motsäger inte databasens standardvärde — utom de listade", () => {
    expect(ratchetDiff(fallbackDeviations(), KNOWN_FALLBACKS)).toEqual({ added: [], gone: [] });
  });

  it("grinden ser det den ska: F-skatt-felet (#1675) och ett motsägande reservvärde", () => {
    const { isTaxeArende } = getTableColumns(db.matters);
    // Före #1675: kolumnen hade DEFAULT false och zod-fältet var nullish utan standardvärde.
    expect(defaultDeviates(isTaxeArende, matterSchema.shape.taxaHasFTax)).toBe(true);
    expect(nullDeviates(isTaxeArende, matterSchema.shape.taxaHasFTax)).toBe(true);
    expect(fieldDeviations("matters.isTaxeArende", isTaxeArende, matterSchema.shape.isTaxeArende)).toEqual([]);
    expect(fileFallbacks("src/lib/shared/kostnadsrakning.ts", new Map([["isTaxeArende", false]]))).toContain(
      "src/lib/shared/kostnadsrakning.ts: isTaxeArende ?? true (4)",
    );
  });
});
