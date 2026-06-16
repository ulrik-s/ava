/**
 * Delad drizzle-db-typ (ADR 0019/0020). Bred nog att både pglite (tester) och
 * node-postgres (produktion, #410) är assignbara. Repositories tar emot `AppDb`
 * så de inte kopplas till en specifik driver.
 */

import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Tredje generic-parametern ger den typade `db.query`-ytan (RQB, relations). */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
