/**
 * Drizzle-schema för Postgres-backenden (ADR 0019, #408) — INKREMENT 1:
 * kärn-identitet + ärende (organizations, offices, users, contacts, matters,
 * matterContacts) + den globala `change_log` som driver delta-sync (ADR 0017).
 *
 * Speglar zod-schemana i `src/lib/shared/schemas/` (zod = sanningskälla, ADR 0019).
 * Enum-fält lagras som `text` (samma strängvärden som zod-enums). Resterande
 * entiteter (faktura, tid, utlägg, kalender, …) följer i #408 inkrement 2.
 */

import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns, boolDefault, orgScopedColumns } from "./columns";

export const organizations = pgTable("organizations", {
  ...baseColumns,
  name: text("name").notNull(),
  orgNumber: text("org_number"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  bankgiro: text("bankgiro"),
  logoPath: text("logo_path"),
  azureTenantId: text("azure_tenant_id"),
  ledgerAccountMap: jsonb("ledger_account_map"),
});

export const offices = pgTable("offices", {
  ...orgScopedColumns,
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isMain: boolDefault("is_main", false),
});

export const users = pgTable("users", {
  ...orgScopedColumns,
  email: text("email").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  role: text("role").notNull().default("LAWYER"),
  matterNumberPrefix: text("matter_number_prefix"),
  hourlyRate: integer("hourly_rate"),
  mileageRate: integer("mileage_rate"),
  active: boolDefault("active", true),
  passwordHash: text("password_hash"),
  azureOid: text("azure_oid"),
  oidcSubject: text("oidc_subject"),
  oidcIssuer: text("oidc_issuer"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  publicKeys: jsonb("public_keys").notNull().default([]),
}, (t) => [index("users_org_idx").on(t.organizationId)]);

export const contacts = pgTable("contacts", {
  ...orgScopedColumns,
  name: text("name").notNull(),
  contactType: text("contact_type").notNull().default("PERSON"),
  personalNumber: text("personal_number"),
  orgNumber: text("org_number"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  parentId: uuid("parent_id"),
}, (t) => [index("contacts_org_idx").on(t.organizationId)]);

export const matters = pgTable("matters", {
  ...orgScopedColumns,
  matterNumber: text("matter_number").notNull(),
  responsibleLawyerId: uuid("responsible_lawyer_id"),
  courtCaseNumber: text("court_case_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE"),
  matterType: text("matter_type"),
  paymentMethod: text("payment_method").notNull().default("PENDING"),
  paymentMethodNote: text("payment_method_note"),
  paymentMethodDecidedAt: timestamp("payment_method_decided_at", { withTimezone: true }),
  isTaxeArende: boolDefault("is_taxe_arende", false),
  taxaLevel: integer("taxa_level"),
  taxaHuvudforhandlingMin: integer("taxa_huvudforhandling_min"),
  taxaHasFTax: boolDefault("taxa_has_f_tax", false),
  taxaHufStart: timestamp("taxa_huf_start", { withTimezone: true }),
  radgivningBetaldAt: timestamp("radgivning_betald_at", { withTimezone: true }),
}, (t) => [index("matters_org_idx").on(t.organizationId)]);

/**
 * MatterContact — join Contact↔Matter med roll. zod-schemat saknar
 * updatedAt/version men reconcile-konventionerna (ADR 0017) ger dem ändå
 * (zod `.passthrough()` tolererar extra fält vid läsning). Org-scope härleds
 * via matter, så ingen egen `organization_id`.
 */
export const matterContacts = pgTable("matter_contacts", {
  ...baseColumns,
  matterId: uuid("matter_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  role: text("role").notNull(),
  notes: text("notes"),
}, (t) => [index("matter_contacts_matter_idx").on(t.matterId)]);

/**
 * Global change-log (ADR 0019 beslut 4) — driver delta-sync: en monoton
 * `seq` per org. Klientens pull = rader där `seq > cursor AND org_id = :org`.
 * `op` = create | update | delete (tombstone). En rad per accepterad skrivning.
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
