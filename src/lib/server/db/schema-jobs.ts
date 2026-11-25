/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * bakgrundsjobbens egna tabeller. Själva köerna ligger i pg-boss eget schema
 * (`pgboss`, ADR 0024), inte här.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Skickade mejl per byrå (#1901, migration 0053, ADR 0024 lager 2).
 * SERVER-ONLY (ingen entitet, synkas aldrig). Nyckeln är byrån + mejlets
 * idempotensnyckel → samma nyckel skickas högst en gång per byrå. Mottagare,
 * ämnesrad och text sparas inte.
 */
export const emailDispatchLog = pgTable("email_dispatch_log", {
  organizationId: uuid("organization_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: "email_dispatch_log_pk", columns: [t.organizationId, t.idempotencyKey] }),
]);
