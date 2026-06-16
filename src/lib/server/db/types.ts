/**
 * Delad drizzle-db-typ (ADR 0019/0020). Bred nog att både pglite (tester) och
 * node-postgres (produktion, #410) är assignbara. Repositories tar emot `AppDb`
 * så de inte kopplas till en specifik driver.
 */

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
