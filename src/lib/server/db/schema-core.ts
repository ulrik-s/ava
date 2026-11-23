/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * kärnan: organisation, kontor, användare, kontakter, ärenden och ärendets kontakter.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { OrgImage } from "@/lib/shared/org-image";
import type {
  ContactType, ConflictCheckStatus, ForundersokningAvslut, MatterRole, MatterStatus, PaymentMethod, UserRole, VehicleType,
} from "@/lib/shared/schemas/enums";
import type { ContactId, MatterContactId, MatterId, OfficeId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { StandardAtgard } from "@/lib/shared/standard-atgard";
import { baseColumns, boolDefault, conflictHitsColumn, hourlyRatesColumn, orgScopedColumns } from "./columns";

export const organizations = pgTable("organizations", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<OrganizationId>(),
  name: text("name").notNull(),
  orgNumber: text("org_number"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  bankgiro: text("bankgiro"),
  /** Webbplats, logga och sidfotsmärke (#1218) — bilderna som data-URL (≤ 300 kB,
   *  zod-validerade i `orgImageSchema`). Ersätter den oanvända `logo_path`. */
  website: text("website"),
  logo: text("logo").$type<OrgImage>(),
  footerSeal: text("footer_seal").$type<OrgImage>(),
  azureTenantId: text("azure_tenant_id"),
  ledgerAccountMap: jsonb("ledger_account_map"),
  documentKinds: jsonb("document_kinds").notNull().default([]).$type<string[]>(), // byråns egna dokumenttyper (ADR 0038)
  documentTags: jsonb("document_tags").notNull().default([]).$type<string[]>(), // föråldrad: taggvokabulären, ersatt av documentKinds
  /** Byråns ärendetyper — valen i "Ärendetyp" när ett ärende läggs upp. */
  matterTypes: jsonb("matter_types").notNull().default([]).$type<string[]>(),
  publicAssignmentMatterTypes: jsonb("public_assignment_matter_types").$type<string[]>(), // offentligt uppdrag (#1638); NULL = aldrig satt
  /** Gränsbelopp (öre) för klientens ackumulerade självrisk innan ett aconto
   *  skickas (#885). NULL = använd default (SJALVRISK_ACCONTO_THRESHOLD_ORE). */
  accontoThresholdOre: integer("acconto_threshold_ore"),
  /** Byråns timpris per kategori (öre/h, exkl moms) — minst specifika nivån (#1206). */
  hourlyRates: hourlyRatesColumn(),
  /** Byråns standardåtgärder (#956) — samma beskrivning + tidsåtgång för alla. */
  standardAtgarder: jsonb("standard_atgarder").notNull().default([]).$type<StandardAtgard[]>(),
});

export const offices = pgTable("offices", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<OfficeId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isMain: boolDefault("is_main", false),
});

export const users = pgTable("users", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<UserId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  role: text("role").notNull().default("LAWYER").$type<UserRole>(),
  matterNumberPrefix: text("matter_number_prefix"),
  /** Juristens timpris per kategori (öre/h) — vinner över byråns (#1206). */
  hourlyRates: hourlyRatesColumn(),
  mileageRate: integer("mileage_rate"),
  /** Biltyp för milersättningen (#1528) — null = inte vald. */
  vehicleType: text("vehicle_type").$type<VehicleType>(),
  active: boolDefault("active", true),
  passwordHash: text("password_hash"),
  azureOid: text("azure_oid"),
  oidcSubject: text("oidc_subject"),
  oidcIssuer: text("oidc_issuer"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => [
  index("users_org_idx").on(t.organizationId),
  // E-postadressen är inloggningen (ADR 0009, #1371): ett konto per adress,
  // över alla byråer (#1408). Samma normalisering som `sameLoginEmail`.
  // Migreringen 0042 skapar indexet bara om befintliga rader tillåter det.
  uniqueIndex("users_login_email_uq").on(sql`lower(btrim(${t.email}))`).where(sql`${t.deletedAt} IS NULL`),
]);

export const contacts = pgTable("contacts", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<ContactId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  contactType: text("contact_type").notNull().default("PERSON").$type<ContactType>(),
  personalNumber: text("personal_number"),
  orgNumber: text("org_number"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  parentId: uuid("parent_id").$type<ContactId>(),
}, (t) => [index("contacts_org_idx").on(t.organizationId)]);

export const matters = pgTable("matters", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<MatterId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  matterNumber: text("matter_number").notNull(),
  responsibleLawyerId: uuid("responsible_lawyer_id").$type<UserId>(),
  courtCaseNumber: text("court_case_number"),
  /** Målnumret före senaste bytet (#1510) — sökbart; bara ett sparas. */
  previousCourtCaseNumber: text("previous_court_case_number"),
  /** Försäkringsbolagets referens (#1511) — sökbar; en per ärende. */
  insuranceReference: text("insurance_reference"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE").$type<MatterStatus>(),
  matterType: text("matter_type"),
  paymentMethod: text("payment_method").notNull().default("PENDING").$type<PaymentMethod>(),
  paymentMethodNote: text("payment_method_note"),
  paymentMethodDecidedAt: timestamp("payment_method_decided_at", { withTimezone: true }),
  isTaxeArende: boolDefault("is_taxe_arende", false),
  taxaLevel: integer("taxa_level"),
  taxaHuvudforhandlingMin: integer("taxa_huvudforhandling_min"),
  taxaHasFTax: boolDefault("taxa_has_f_tax", true), // F-skatt är normen (#1675, 0051)
  taxaHufStart: timestamp("taxa_huf_start", { withTimezone: true }),
  radgivningBetaldAt: timestamp("radgivning_betald_at", { withTimezone: true }),
  /** Klientens andel (självrisk/avgift) i bips — rättsskydd/rättshjälp (#778). */
  clientShareBips: integer("client_share_bips"),
  /** Ärendets avvikande timpris per kategori (öre/h) — ovanligt; vinner över jurist och byrå (#1206). */
  hourlyRates: hourlyRatesColumn(),
  /** Rättsskyddets maxbelopp (öre) resp. rättshjälpens timtak — täcknings-tak (#793). */
  rattsskyddMaxOre: integer("rattsskydd_max_ore"),
  /** Rättsskyddets lägsta självrisk (öre) — "dock lägst 1 800 kr" (#899). */
  rattsskyddSjalvriskMinOre: integer("rattsskydd_sjalvrisk_min_ore"),
  rattshjalpMaxTimmar: integer("rattshjalp_max_timmar"),
  /** Rättsskydd (#810): tvistdatum (arbete före = ej täckt) + bolagets beslutsdatum (retro ≤6h). */
  tvistUppkomDatum: timestamp("tvist_uppkom_datum", { withTimezone: true }),
  rattsskyddBeslutDatum: timestamp("rattsskydd_beslut_datum", { withTimezone: true }),
  /** Rättsskydd (#811): datum då rättsskydd nekades → föreslå rättshjälp. */
  rattsskyddNekadAt: timestamp("rattsskydd_nekad_at", { withTimezone: true }),
  /** Jävskontrollen (#1246): status, antal träffar, när den kördes, och träffarna (#1818, null = aldrig sparade). */
  conflictCheckStatus: text("conflict_check_status").$type<ConflictCheckStatus>(),
  /** Förundersökningens avslut i förordnandemål (#1855); null = inte markerat. */
  forundersokningAvslut: text("forundersokning_avslut").$type<ForundersokningAvslut>(),
  conflictCheckHits: integer("conflict_check_hits"),
  conflictCheckedAt: timestamp("conflict_checked_at", { withTimezone: true }),
  conflictCheckResults: conflictHitsColumn("conflict_check_results"),
  conflictReviewedHits: conflictHitsColumn("conflict_reviewed_hits"),
  /** Bedömningen av träffarna (#1354): vem, när och motiveringen. */
  conflictReviewedById: uuid("conflict_reviewed_by_id").$type<UserId>(),
  conflictReviewedAt: timestamp("conflict_reviewed_at", { withTimezone: true }),
  conflictReviewNote: text("conflict_review_note"),
}, (t) => [index("matters_org_idx").on(t.organizationId)]);

/**
 * MatterContact — join Contact↔Matter med roll. zod-schemat saknar
 * updatedAt/version men reconcile-konventionerna (ADR 0017) ger dem ändå
 * (zod `.passthrough()` tolererar extra fält vid läsning). Org-scope härleds
 * via matter, så ingen egen `organization_id`.
 */
export const matterContacts = pgTable("matter_contacts", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<MatterContactId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  contactId: uuid("contact_id").notNull().$type<ContactId>(),
  role: text("role").notNull().$type<MatterRole>(),
  notes: text("notes"),
}, (t) => [index("matter_contacts_matter_idx").on(t.matterId)]);
