/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * relationerna (ADR 0020) för Drizzles relationella `with`-queries.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { relations } from "drizzle-orm";
import {
  timeEntries, expenses, invoices, payments, writeOffs, paymentPlans, paymentPlanReminders,
} from "./schema-billing";
import { users, contacts, matters, matterContacts } from "./schema-core";
import { documents } from "./schema-documents";

// ─── Relations (ADR 0020) — driver Drizzles relationella `with`-queries för
//     repository-läsningar (getByIdWith…/list). Genererar ingen SQL (app-nivå).
//     Self-ref/dubbel-FK (accontoDeductions, credited/creditNote) hanteras via
//     explicita sekundär-queries i repona (undviker relationName-komplexitet här).

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  matter: one(matters, { fields: [invoices.matterId], references: [matters.id] }),
  payments: many(payments),
  writeOffs: many(writeOffs),
  paymentPlan: one(paymentPlans),
  timeEntries: many(timeEntries),
  expenses: many(expenses),
  documents: many(documents),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  recordedBy: one(users, { fields: [payments.recordedById], references: [users.id] }),
}));

export const writeOffsRelations = relations(writeOffs, ({ one }) => ({
  invoice: one(invoices, { fields: [writeOffs.invoiceId], references: [invoices.id] }),
}));

export const paymentPlansRelations = relations(paymentPlans, ({ one, many }) => ({
  invoice: one(invoices, { fields: [paymentPlans.invoiceId], references: [invoices.id] }),
  reminders: many(paymentPlanReminders),
}));

export const paymentPlanRemindersRelations = relations(paymentPlanReminders, ({ one }) => ({
  plan: one(paymentPlans, { fields: [paymentPlanReminders.planId], references: [paymentPlans.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  invoice: one(invoices, { fields: [timeEntries.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [timeEntries.matterId], references: [matters.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  invoice: one(invoices, { fields: [expenses.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [expenses.matterId], references: [matters.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  invoice: one(invoices, { fields: [documents.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [documents.matterId], references: [matters.id] }),
}));

// matter↔kontakt via junction (matterContacts). Driver `with`-nesting för
// repository-läsningar som behöver KLIENT-kontakten (paymentPlan/matter m.fl.).
export const mattersRelations = relations(matters, ({ many }) => ({
  contacts: many(matterContacts),
}));

export const matterContactsRelations = relations(matterContacts, ({ one }) => ({
  matter: one(matters, { fields: [matterContacts.matterId], references: [matters.id] }),
  contact: one(contacts, { fields: [matterContacts.contactId], references: [contacts.id] }),
}));
