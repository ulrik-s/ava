/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * kalender/task, tjänsteanteckning, preferenser, mallar och jävssök.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  CalendarEventKind, CalendarEventVisibility, TaskPriority, TaskStatus,
} from "@/lib/shared/schemas/calendar";
import type {
  CalendarEventId, ConflictCheckId, DocumentTemplateId, MatterId, OrganizationId, OrgPreferenceId, ServiceNoteId,
  TaskId, UserId, UserPreferenceId,
} from "@/lib/shared/schemas/ids";
import { baseColumns, boolDefault, orgScopedColumns } from "./columns";

// ─── Kalender / Task ─────────────────────────────────────────────────────────

export const calendarEvents = pgTable("calendar_events", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<CalendarEventId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  kind: text("kind").notNull().default("appointment").$type<CalendarEventKind>(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolDefault("all_day", false),
  matterId: uuid("matter_id").$type<MatterId>(),
  visibility: text("visibility").notNull().default("normal").$type<CalendarEventVisibility>(),
  mirrorToOutlook: boolDefault("mirror_to_outlook", false),
  outlookEventId: text("outlook_event_id"),
  outlookCalendarId: text("outlook_calendar_id"),
  mirrorStatus: text("mirror_status").$type<"pending" | "synced" | "failed">(),
  mirrorError: text("mirror_error"),
  mirrorLastSyncedAt: timestamp("mirror_last_synced_at", { withTimezone: true }),
}, (t) => [index("calendar_events_user_idx").on(t.userId)]);

export const tasks = pgTable("tasks", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<TaskId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("TODO").$type<TaskStatus>(),
  priority: text("priority").notNull().default("MEDIUM").$type<TaskPriority>(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  matterId: uuid("matter_id").$type<MatterId>(),
}, (t) => [index("tasks_user_idx").on(t.userId)]);

// ─── Tjänsteanteckning / Preferenser / Mallar / Jävssök ──────────────────────

export const serviceNotes = pgTable("service_notes", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<ServiceNoteId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  authorId: uuid("author_id").notNull().$type<UserId>(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  text: text("text").notNull(),
}, (t) => [index("service_notes_matter_idx").on(t.matterId)]);

export const userPreferences = pgTable("user_preferences", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<UserPreferenceId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  organizationId: uuid("organization_id").$type<OrganizationId>(),
  key: text("key").notNull(),
  prefs: jsonb("prefs").notNull().$type<Record<string, unknown>>(),
}, (t) => [index("user_preferences_user_idx").on(t.userId)]);

export const orgPreferences = pgTable("org_preferences", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<OrgPreferenceId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  key: text("key").notNull(),
  prefs: jsonb("prefs").notNull().$type<Record<string, unknown>>(),
  createdById: uuid("created_by_id").$type<UserId>(),
});

export const documentTemplates = pgTable("document_templates", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<DocumentTemplateId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  content: text("content").notNull(),
  createdById: uuid("created_by_id").notNull().$type<UserId>(),
});

export const conflictChecks = pgTable("conflict_checks", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<ConflictCheckId>(),
  searchTerm: text("search_term").notNull(),
  searchType: text("search_type").notNull().$type<"name" | "personalNumber" | "both">(),
  results: jsonb("results").notNull().default([]).$type<unknown[]>(),
  checkedById: uuid("checked_by_id").notNull().$type<UserId>(),
  matterId: uuid("matter_id").$type<MatterId>(), // #1818: ingen främmande nyckel; null = fristående eller äldre rad
}, (t) => [index("conflict_checks_matter_idx").on(t.matterId)]);
