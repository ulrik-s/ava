/**
 * Drizzle-schema för Postgres-backenden (ADR 0019, #408) — alla entiteter:
 * kärn-identitet + ärende, billing (faktura/tid/utlägg/betalning/plan/run/…),
 * dokument, kalender/task, tjänsteanteckning, preferenser, mallar, jävssök, samt
 * den globala `change_log` som driver delta-sync (ADR 0017).
 *
 * Speglar zod-schemana i `src/lib/shared/schemas/` (zod = sanningskälla, ADR 0019).
 * Enum-fält lagras som `text` (samma strängvärden som zod-enums). Monetära öre-
 * belopp + sizeBytes är `bigint` (mode:number) för att undvika int4-overflow.
 * Reconcile-konventionerna (version/updatedAt/deletedAt) gäller ALLA tabeller,
 * även de vars zod-schema saknar dem (zod `.passthrough()` tolererar vid läsning).
 *
 * Schemat är delat i en modul per område (`schema-*.ts`), som re-exporteras
 * härifrån. En ny modul läggs till med en `export *`-rad nedan.
 */

export * from "./schema-core";
export * from "./schema-sync";
export * from "./schema-billing";
export * from "./schema-documents";
export * from "./schema-misc";
export * from "./schema-relations";
