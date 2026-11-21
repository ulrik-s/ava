/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * synken: den globala `change_log` och synkens epok, replays och enheter (ADR 0017).
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { bigserial, boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Global change-log (ADR 0019 beslut 4) — driver delta-sync: en monoton
 * `seq` per org. Klientens pull = rader där `seq > cursor AND org_id = :org`.
 * `op` = create | update | delete (tombstone). En rad per accepterad skrivning.
 * `seq` får sitt slutliga värde när transaktionen committar, och pullen läser
 * bara upp till `change_log_safe_seq()` (#1381, migration 0040) — en cursor
 * kan inte gå förbi en rad som committas senare.
 */
export const changeLog = pgTable("change_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  entity: text("entity").notNull(),
  rowId: uuid("row_id").notNull(),
  version: integer("version").notNull(),
  op: text("op").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("change_log_org_seq_idx").on(t.organizationId, t.seq)]);

/**
 * Synkens epok (#1360, migration 0041) — ett id för databasens change_log-
 * historik, en enda rad. Byts när databasen återställs ur en backup
 * (`restore-db.sh`); en klient med en annan epok synkar om från 0.
 * SERVER-ONLY (ingen entitet, synkas aldrig).
 */
export const syncEpoch = pgTable("sync_epoch", {
  singleton: boolean("singleton").primaryKey().default(true),
  epoch: uuid("epoch").notNull().defaultRandom(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Utfall av köade procedur-anrop som servern kört om (#1265, ADR 0037).
 * SERVER-ONLY (ingen entitet, synkas aldrig). Nyckeln är byrån + klientens
 * `mutationId` (#1353) → samma anrop körs högst en gång, även om klienten skickar det
 * igen efter ett avbrott. Ett accepterat utfall skrivs i SAMMA transaktion som
 * anropets skrivningar; ett avvisat efteråt (ingenting annat skrevs).
 */
export const syncReplays = pgTable("sync_replays", {
  mutationId: uuid("mutation_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id"),
  path: text("path").notNull(),
  codeVersion: text("code_version").notNull(),
  /** accepted | rejected */
  status: text("status").notNull(),
  /** tRPC-kod och regelns meddelande (bara rejected). */
  code: text("code"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Byrå + mutationId (#1353): uppslagen är byråavgränsade, och en annan byrås
  // rad med samma mutationId får aldrig blockera (eller besvara) byråns anrop.
  primaryKey({ name: "sync_replays_pk", columns: [t.organizationId, t.mutationId] }),
  index("sync_replays_org_at_idx").on(t.organizationId, t.at),
]);

/**
 * Synkläget per enhet (#1267) — senaste rapporten från varje webbläsare.
 * Server-only (ingen entitet, synkas aldrig).
 */
export const syncDevices = pgTable("sync_devices", {
  deviceId: uuid("device_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  label: text("label"),
  pendingCount: integer("pending_count").notNull(),
  oldestPendingAt: timestamp("oldest_pending_at", { withTimezone: true }),
  /** Felet som stoppade enhetens senaste synk, null när den lyckades (#1353). */
  lastError: text("last_error"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sync_devices_org_idx").on(t.organizationId)]);
