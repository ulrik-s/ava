/**
 * Convenience-helpers för att emit:a events från tRPC-routrar.
 *
 * Designprincip: emit-funktionerna ska vara så lätta att läsa **i routerns
 * mutation** att man inte missar dem. Skriv en rad — `await emit.matterCreated(ctx, matter, ...)`
 * — istället för fyra rader inline.
 *
 * Felsäkerhet: om emit kastar (DB-fel etc.) ska det INTE ta ner användarens
 * mutation. Vi sväljer felet och loggar — eventen kommer att saknas i loggen
 * men vi har minst en upstream-rad i Postgres-loggen om felet.
 */

import type { IDataStore } from "../data-store/IDataStore";
import type { EventType, EmitInput } from "./schema";

/** Den minimal subset av tRPC-context som emit-helpers behöver. */
export interface EmitCtx {
  dataStore: IDataStore;
  user: { id: string };
}

async function safeEmit(ctx: EmitCtx, input: EmitInput): Promise<void> {
  try {
    await ctx.dataStore.events.emit(input);
  } catch (err) {
    // Read-only event-loggar (demo-/git-backend + generator) kan inte emit:a —
    // det är väntat, inte ett fel. Logga bara oväntade fel.
    if (err instanceof Error && err.name === "ReadOnlyError") return;
    console.error("[emit] event-skrivning misslyckades:", err, { type: input.type });
  }
}

/** Bygg payload + emit för en användar-initierad mutation. */
function emitUser(ctx: EmitCtx, type: EventType, payload: Record<string, unknown>, matterId?: string) {
  return safeEmit(ctx, {
    type,
    source: "ui",
    actor: { kind: "user", id: ctx.user.id },
    matterId,
    payload,
  });
}

/** Bygg payload + emit för en system-initierad händelse (payment-scan m.fl.). */
function emitSystem(ctx: EmitCtx, type: EventType, payload: Record<string, unknown>, matterId?: string) {
  return safeEmit(ctx, {
    type,
    source: "system",
    actor: { kind: "system", id: "payment-scan" },
    matterId,
    payload,
  });
}

export const emit = {
  // ── matter ─────────────────────────────────────────────────────
  matterCreated: (ctx: EmitCtx, matter: { id: string; matterNumber: string; title: string }) =>
    emitUser(ctx, "matter.created", { matterNumber: matter.matterNumber, title: matter.title }, matter.id),

  matterUpdated: (ctx: EmitCtx, matterId: string, patch: Record<string, unknown>) =>
    emitUser(ctx, "matter.updated", { patch }, matterId),

  matterStatusChanged: (ctx: EmitCtx, matterId: string, from: string, to: string) =>
    emitUser(ctx, "matter.status_changed", { from, to }, matterId),

  matterArchived: (ctx: EmitCtx, matterId: string) =>
    emitUser(ctx, "matter.archived", {}, matterId),

  // ── contact ────────────────────────────────────────────────────
  contactCreated: (ctx: EmitCtx, contact: { id: string; name: string }) =>
    emitUser(ctx, "contact.created", { contactId: contact.id, name: contact.name }),

  contactUpdated: (ctx: EmitCtx, contactId: string, patch: Record<string, unknown>) =>
    emitUser(ctx, "contact.updated", { contactId, patch }),

  contactDeleted: (ctx: EmitCtx, contactId: string) =>
    emitUser(ctx, "contact.deleted", { contactId }),

  // ── document ───────────────────────────────────────────────────
  documentUploaded: (ctx: EmitCtx, doc: { id: string; fileName: string; matterId: string }) =>
    emitUser(ctx, "document.uploaded", { documentId: doc.id, fileName: doc.fileName }, doc.matterId),

  documentDeleted: (ctx: EmitCtx, doc: { id: string; matterId: string }) =>
    emitUser(ctx, "document.deleted", { documentId: doc.id }, doc.matterId),

  documentAnalyzed: (ctx: EmitCtx, doc: { id: string; matterId: string }, result: Record<string, unknown>) =>
    emitUser(ctx, "document.analyzed", { documentId: doc.id, result }, doc.matterId),

  // ── invoice ────────────────────────────────────────────────────
  invoiceCreated: (ctx: EmitCtx, inv: { id: string; matterId: string; amount: number }) =>
    emitUser(ctx, "invoice.created", { invoiceId: inv.id, amount: inv.amount }, inv.matterId),

  invoiceSent: (ctx: EmitCtx, invoiceId: string, matterId: string) =>
    emitUser(ctx, "invoice.sent", { invoiceId }, matterId),

  invoicePaymentReceived: (ctx: EmitCtx, invoiceId: string, matterId: string, amount: number) =>
    emitUser(ctx, "invoice.payment_received", { invoiceId, amount }, matterId),

  invoiceWrittenOff: (ctx: EmitCtx, invoiceId: string, matterId: string, amount: number) =>
    emitUser(ctx, "invoice.written_off", { invoiceId, amount }, matterId),

  // ── time-entry ─────────────────────────────────────────────────
  timeEntryAdded: (ctx: EmitCtx, entry: { id: string; matterId: string; minutes: number }) =>
    emitUser(ctx, "time-entry.added", { entryId: entry.id, minutes: entry.minutes }, entry.matterId),

  timeEntryUpdated: (ctx: EmitCtx, entry: { id: string; matterId: string }) =>
    emitUser(ctx, "time-entry.updated", { entryId: entry.id }, entry.matterId),

  timeEntryDeleted: (ctx: EmitCtx, entryId: string, matterId: string) =>
    emitUser(ctx, "time-entry.deleted", { entryId }, matterId),

  // ── kostnadsräkning ────────────────────────────────────────────
  kostnadsrakningGenerated: (
    ctx: EmitCtx,
    matterId: string,
    payload: {
      documentId: string;
      fileName: string;
      totalInclVat: number;
      huvudforhandlingMinutes: number;
      organizationId: string;
    },
  ) => emitUser(ctx, "kostnadsrakning.generated", payload, matterId),

  // ── payment-plan-påminnelser (payment-scan, #23) ───────────────
  paymentDue: (ctx: EmitCtx, payload: Record<string, unknown>, matterId?: string) =>
    emitSystem(ctx, "payment.due", payload, matterId),

  paymentOverdue: (ctx: EmitCtx, payload: Record<string, unknown>, matterId?: string) =>
    emitSystem(ctx, "payment.overdue", payload, matterId),

  // ── user / generic ─────────────────────────────────────────────
  userAction: (ctx: EmitCtx, payload: Record<string, unknown>) =>
    emitUser(ctx, "user.action", payload),
};
