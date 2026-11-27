/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * dokument: mappar, dokument, delar, sidor och analysförslag.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { sql } from "drizzle-orm";
import {
  bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import type { DocumentKind } from "@/lib/shared/document-kind";
import type { DocumentPartSource, FinalRuling } from "@/lib/shared/schemas/document";
import type { ContactType, MatterRole, SuggestionStatus } from "@/lib/shared/schemas/enums";
import type {
  BillingRunId, ContactId, DocumentAnalysisSuggestionId, DocumentFolderId, DocumentId, DocumentPartId, InvoiceId,
  MatterEventSuggestionId, MatterId, UserId,
} from "@/lib/shared/schemas/ids";
import { baseColumns, boolDefault } from "./columns";

// ─── Dokument ──────────────────────────────────────────────────────────────

export const documentFolders = pgTable("document_folders", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentFolderId>(),
  name: text("name").notNull(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  parentId: uuid("parent_id").$type<DocumentFolderId>(),
}, (t) => [index("document_folders_matter_idx").on(t.matterId)]);

export const documents = pgTable("documents", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  /** Valfri faktura-koppling (#397: genererade faktura-dokument). */
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  /** Faktureringskörningen dokumentet hör till (#1230: kostnadsräkningens PDF) —
   *  ångras körningen tas dokumentet bort. Null = ingen koppling. */
  billingRunId: uuid("billing_run_id").$type<BillingRunId>(),
  folderId: uuid("folder_id").$type<DocumentFolderId>(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storagePath: text("storage_path").notNull(),
  uploadedById: uuid("uploaded_by_id").notNull().$type<UserId>(),
  title: text("title"),
  kinds: jsonb("kinds").notNull().default([]).$type<string[]>(), // dokumentets typer, primär först (ADR 0038)
  kindsManual: boolean("kinds_manual").notNull().default(false), // satta av person/system → AI:n ändrar dem inte
  documentType: text("document_type"), // föråldrad: spegel av primärtypen för äldre klienter
  /** Riktning (#880): INKOMMANDE / UTGAENDE — null där det saknar mening. */
  direction: text("direction").$type<"INKOMMANDE" | "UTGAENDE">(),
  /** Motpart/mottagare (#901) — driver "dok skickade till domstol"-filtret. */
  recipient: text("recipient").$type<"DOMSTOL" | "MOTPART" | "KLIENT" | "FORSAKRING" | "MYNDIGHET" | "OVRIGT">(),
  /** Igenkänt slutligt avgörande (#2098) — null = inget igenkänt. */
  finalRuling: text("final_ruling").$type<FinalRuling>(),
  tags: jsonb("tags").notNull().default([]).$type<string[]>(), // föråldrad: ersatt av kinds (ADR 0038)
  summary: text("summary"),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  analysisStatus: text("analysis_status").$type<"PENDING" | "RUNNING" | "DONE" | "ERROR">(),
  analysisModel: text("analysis_model"),
  analysisError: text("analysis_error"),
}, (t) => [index("documents_matter_idx").on(t.matterId)]);

/**
 * Delar av ett sammansatt dokument (#1220) — "kallelse + stämning + FUP" i EN
 * fil. Kategori + sidintervall (1-baserat, inklusive); filen delas aldrig.
 * Synkad entitet: org härleds via `matter_id` (speglar dokumentets ärende).
 * `source` = AUTO (segmenteringen) | MANUAL (användaren rättade typen).
 */
export const documentParts = pgTable("document_parts", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentPartId>(),
  documentId: uuid("document_id").notNull().$type<DocumentId>()
    .references(() => documents.id, { onDelete: "cascade" }),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull().$type<DocumentKind>(),
  fromPage: integer("from_page").notNull(),
  toPage: integer("to_page").notNull(),
  source: text("source").notNull().$type<DocumentPartSource>(),
}, (t) => [
  index("document_parts_document_idx").on(t.documentId),
  index("document_parts_matter_idx").on(t.matterId),
]);

/** Postgres `tsvector` (fulltext-sökvektor) — läses aldrig som värde, bara i frågor. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Text per sida i ett dokument (#1215) — serverns fulltextindex. SERVER-ONLY:
 * ingen entitet (inget id/version/deletedAt), inget change_log, synkas aldrig
 * till klienter (kan bli stort; klienten söker via serverns tRPC). Org-scopas
 * via dokumentets ärende. `tsv` genereras av Postgres med 'swedish'-stemming.
 * Hård delete av dokumentet kaskaderar; mjuk delete rensar i dokument-repot.
 * Sidnumret är grunden för dokumentdelar (steg 2 av flerdokuments-PDF:er).
 */
export const documentPages = pgTable("document_pages", {
  documentId: uuid("document_id").notNull().$type<DocumentId>()
    .references(() => documents.id, { onDelete: "cascade" }),
  /** 1-baserat sidnummer. */
  pageNo: integer("page_no").notNull(),
  text: text("text").notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('swedish'::regconfig, text)`),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.pageNo] }),
  index("document_pages_tsv_idx").using("gin", t.tsv),
]);

export const documentAnalysisSuggestions = pgTable("document_analysis_suggestions", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentAnalysisSuggestionId>(),
  documentId: uuid("document_id").notNull().$type<DocumentId>(),
  name: text("name").notNull(),
  role: text("role").notNull().$type<MatterRole>(),
  contactType: text("contact_type").notNull().$type<ContactType>(),
  email: text("email"),
  phone: text("phone"),
  orgNumber: text("org_number"),
  personalNumber: text("personal_number"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING").$type<SuggestionStatus>(),
  acceptedContactId: uuid("accepted_contact_id").$type<ContactId>(),
}, (t) => [index("doc_analysis_suggestions_doc_idx").on(t.documentId)]);

export const matterEventSuggestions = pgTable("matter_event_suggestions", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<MatterEventSuggestionId>(),
  documentId: uuid("document_id").notNull().$type<DocumentId>(),
  title: text("title").notNull(),
  description: text("description"),
  eventType: text("event_type"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolDefault("all_day", false),
  location: text("location"),
  status: text("status").notNull().default("PENDING").$type<SuggestionStatus>(),
}, (t) => [index("matter_event_suggestions_doc_idx").on(t.documentId)]);
