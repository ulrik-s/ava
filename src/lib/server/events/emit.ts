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

import type { MatterStatus } from "@/lib/shared/schemas/enums";
import type {
  ContactId, DocumentId, InvoiceId, MatterId, OrganizationId, TimeEntryId, UserId,
} from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type { EventType, EmitInput } from "./schema";

/** Den minimal subset av tRPC-context som emit-helpers behöver. */
export interface EmitCtx {
  dataStore: Pick<IDataStore, "events">;
  user: { id: UserId };
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
function emitUser(ctx: EmitCtx, type: EventType, payload: Record<string, unknown>, matterId?: MatterId) {
  return safeEmit(ctx, {
    type,
    source: "ui",
    actor: { kind: "user", id: ctx.user.id },
    matterId,
    payload,
  });
}

/** Bygg payload + emit för en system-initierad händelse (payment-scan m.fl.). */
function emitSystem(ctx: EmitCtx, type: EventType, payload: Record<string, unknown>, matterId?: MatterId) {
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
  matterCreated: (ctx: EmitCtx, matter: { id: MatterId; matterNumber: string; title: string }) =>
    emitUser(ctx, "matter.created", { matterNumber: matter.matterNumber, title: matter.title }, matter.id),

  matterUpdated: (ctx: EmitCtx, matterId: MatterId, patch: Record<string, unknown>) =>
    emitUser(ctx, "matter.updated", { patch }, matterId),

  matterStatusChanged: (ctx: EmitCtx, matterId: MatterId, from: MatterStatus, to: MatterStatus) =>
    emitUser(ctx, "matter.status_changed", { from, to }, matterId),

  matterArchived: (ctx: EmitCtx, matterId: MatterId) =>
    emitUser(ctx, "matter.archived", {}, matterId),

  // ── contact ────────────────────────────────────────────────────
  contactCreated: (ctx: EmitCtx, contact: { id: ContactId; name: string }) =>
    emitUser(ctx, "contact.created", { contactId: contact.id, name: contact.name }),

  contactUpdated: (ctx: EmitCtx, contactId: ContactId, patch: Record<string, unknown>) =>
    emitUser(ctx, "contact.updated", { contactId, patch }),

  contactDeleted: (ctx: EmitCtx, contactId: ContactId) =>
    emitUser(ctx, "contact.deleted", { contactId }),

  // ── document ───────────────────────────────────────────────────
  documentUploaded: (ctx: EmitCtx, doc: { id: DocumentId; fileName: string; matterId: MatterId }) =>
    emitUser(ctx, "document.uploaded", { documentId: doc.id, fileName: doc.fileName }, doc.matterId),

  documentDeleted: (ctx: EmitCtx, doc: { id: DocumentId; matterId: MatterId }) =>
    emitUser(ctx, "document.deleted", { documentId: doc.id }, doc.matterId),

  documentAnalyzed: (ctx: EmitCtx, doc: { id: DocumentId; matterId: MatterId }, result: Record<string, unknown>) =>
    emitUser(ctx, "document.analyzed", { documentId: doc.id, result }, doc.matterId),

  // ── invoice ────────────────────────────────────────────────────
  invoiceCreated: (ctx: EmitCtx, inv: { id: InvoiceId; matterId: MatterId; amount: number }) =>
    emitUser(ctx, "invoice.created", { invoiceId: inv.id, amount: inv.amount }, inv.matterId),

  invoiceSent: (ctx: EmitCtx, invoiceId: InvoiceId, matterId: MatterId) =>
    emitUser(ctx, "invoice.sent", { invoiceId }, matterId),

  invoicePaymentReceived: (ctx: EmitCtx, invoiceId: InvoiceId, matterId: MatterId, amount: number) =>
    emitUser(ctx, "invoice.payment_received", { invoiceId, amount }, matterId),

  invoiceWrittenOff: (ctx: EmitCtx, invoiceId: InvoiceId, matterId: MatterId, amount: number) =>
    emitUser(ctx, "invoice.written_off", { invoiceId, amount }, matterId),

  // ── time-entry ─────────────────────────────────────────────────
  timeEntryAdded: (ctx: EmitCtx, entry: { id: TimeEntryId; matterId: MatterId; minutes: number }) =>
    emitUser(ctx, "time-entry.added", { entryId: entry.id, minutes: entry.minutes }, entry.matterId),

  timeEntryUpdated: (ctx: EmitCtx, entry: { id: TimeEntryId; matterId: MatterId }) =>
    emitUser(ctx, "time-entry.updated", { entryId: entry.id }, entry.matterId),

  timeEntryDeleted: (ctx: EmitCtx, entryId: TimeEntryId, matterId: MatterId) =>
    emitUser(ctx, "time-entry.deleted", { entryId }, matterId),

  // ── kostnadsräkning ────────────────────────────────────────────
  kostnadsrakningGenerated: (
    ctx: EmitCtx,
    matterId: MatterId,
    payload: {
      documentId: DocumentId;
      fileName: string;
      totalInclVat: number;
      huvudforhandlingMinutes: number;
      organizationId: OrganizationId;
    },
  ) => emitUser(ctx, "kostnadsrakning.generated", payload, matterId),

  // ── payment-plan-påminnelser (payment-scan, #23) ───────────────
  paymentDue: (ctx: EmitCtx, payload: Record<string, unknown>, matterId?: MatterId) =>
    emitSystem(ctx, "payment.due", payload, matterId),

  paymentOverdue: (ctx: EmitCtx, payload: Record<string, unknown>, matterId?: MatterId) =>
    emitSystem(ctx, "payment.overdue", payload, matterId),

  // ── user / generic ─────────────────────────────────────────────
  userAction: (ctx: EmitCtx, payload: Record<string, unknown>) =>
    emitUser(ctx, "user.action", payload),
};
