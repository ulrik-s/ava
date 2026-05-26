/**
 * Domän-enums för git-db-entiteter. Single source of truth — TS-union-typer,
 * Zod-scheman och labels härleds från konstanterna.
 *
 * Vid ny enum-medlem: lägg till i objektliteralen, allt annat uppdateras.
 */

import { z } from "zod";

// Hjälpare så vi kan skriva `enumFromLabels(LABELS)` istället för att
// upprepa nyckel-extraktion + z.enum(...) för varje enum.
function enumFromLabels<L extends Record<string, string>>(labels: L) {
  const keys = Object.keys(labels) as [keyof L & string, ...(keyof L & string)[]];
  return z.enum(keys);
}

// ─── User role ────────────────────────────────────────────────────────────

export const USER_ROLE_LABELS = {
  ADMIN: "Admin",
  LAWYER: "Advokat",
  ASSISTANT: "Assistent",
} as const satisfies Record<string, string>;
export const userRoleSchema = enumFromLabels(USER_ROLE_LABELS);
export type UserRole = z.infer<typeof userRoleSchema>;

// ─── Matter status ────────────────────────────────────────────────────────

export const MATTER_STATUS_LABELS = {
  ACTIVE: "Aktivt",
  CLOSED: "Stängt",
  ARCHIVED: "Arkiverat",
} as const satisfies Record<string, string>;
export const matterStatusSchema = enumFromLabels(MATTER_STATUS_LABELS);
export type MatterStatus = z.infer<typeof matterStatusSchema>;

// ─── Payment method (per matter) ──────────────────────────────────────────

export const PAYMENT_METHOD_LABELS = {
  PENDING: "Ej fastställt",
  RATTSHJALP: "Rättshjälp",
  RATTSSKYDD: "Rättsskydd",
  OFFENTLIG_FORSVARARE: "Offentlig försvarare",
  PRIVAT: "Privat",
  MIX: "Mix",
} as const satisfies Record<string, string>;
export const paymentMethodSchema = enumFromLabels(PAYMENT_METHOD_LABELS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

// ─── Invoice status + type ────────────────────────────────────────────────

export const INVOICE_STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  PAID: "Betald",
  CANCELLED: "Annullerad",
  BAD_DEBT: "Kundförlust",
  INSTALLMENT_PLAN: "Avbetalningsplan",
} as const satisfies Record<string, string>;
export const invoiceStatusSchema = enumFromLabels(INVOICE_STATUS_LABELS);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const INVOICE_TYPE_LABELS = {
  STANDARD: "Standard",
  ACCONTO: "Acconto",
  FINAL: "Slutfaktura",
  CREDIT: "Kreditfaktura",
} as const satisfies Record<string, string>;
export const invoiceTypeSchema = enumFromLabels(INVOICE_TYPE_LABELS);
export type InvoiceType = z.infer<typeof invoiceTypeSchema>;

// ─── Payment plan status + reminder type ──────────────────────────────────

export const PAYMENT_PLAN_STATUS_LABELS = {
  ACTIVE: "Aktiv",
  COMPLETED: "Slutförd",
  CANCELLED: "Avbruten",
} as const satisfies Record<string, string>;
export const paymentPlanStatusSchema = enumFromLabels(PAYMENT_PLAN_STATUS_LABELS);
export type PaymentPlanStatus = z.infer<typeof paymentPlanStatusSchema>;

export const REMINDER_TYPE_LABELS = {
  DUE: "Förfaller",
  OVERDUE: "Förfallen",
} as const satisfies Record<string, string>;
export const reminderTypeSchema = enumFromLabels(REMINDER_TYPE_LABELS);
export type ReminderType = z.infer<typeof reminderTypeSchema>;

// ─── Suggestion status (AI-extraktioner) ──────────────────────────────────

export const SUGGESTION_STATUS_LABELS = {
  PENDING: "Väntar",
  ACCEPTED: "Accepterad",
  REJECTED: "Avvisad",
} as const satisfies Record<string, string>;
export const suggestionStatusSchema = enumFromLabels(SUGGESTION_STATUS_LABELS);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

// Note: MATTER_ROLE och CONTACT_TYPE finns i src/client/lib/labels.ts och
// re-exporteras därifrån för att inte duplicera. Skulle kunna flyttas hit
// i en framtida städ-runda om labels.ts blir för stor.
