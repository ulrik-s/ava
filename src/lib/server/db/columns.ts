/**
 * Delade kolumn-konventioner för Postgres-backenden (ADR 0019, #408).
 *
 * Varje muterbar entitet har:
 *   - `id uuid` (klient-genererad UUIDv7, ADR 0003)
 *   - `created_at` / `updated_at` (timestamptz)
 *   - `version int` (app-bumpas i PostgresStore, ADR 0017)
 *   - `deleted_at` (mjuk delete → tombstone som propageras i delta-pull)
 *
 * Org-scopade entiteter lägger till `organization_id`.
 */

import { boolean, integer, timestamp, uuid } from "drizzle-orm/pg-core";

export const baseColumns = {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
} as const;

export const orgScopedColumns = {
  ...baseColumns,
  organizationId: uuid("organization_id").notNull(),
} as const;

/** Återanvändbar boolean-default-helper (håller tabell-defs läsbara). */
export const boolDefault = (name: string, value: boolean) => boolean(name).notNull().default(value);
