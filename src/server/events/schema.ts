/**
 * Event-schemat — förstklassig medborgare i AVA enligt
 * `docs/architecture-future.md` §2.1.
 *
 * Allt som ändrar systemet skrivs som ett event INNAN det manifesteras
 * i datalagret. Event-loggen är append-only och utgör:
 *   - Source of truth för audit
 *   - Trigger för regelmotorn
 *   - Underlag för rerun/debug
 *   - Mekanism för sync i local-first-läget
 */

import { z } from "zod";

/**
 * Event-typer registrerade hittills. Lägg nya till stränglistan när du
 * introducerar dem — kompilatorn kommer säga var alla `emitEvent`-anrop
 * måste uppdateras.
 */
export const EVENT_TYPES = [
  // matter
  "matter.created",
  "matter.updated",
  "matter.status_changed",
  "matter.archived",
  // contact
  "contact.created",
  "contact.updated",
  "contact.deleted",
  // document
  "document.uploaded",
  "document.deleted",
  "document.analyzed",
  "document.tagged",
  // mail
  "mail.received",
  "mail.sent",
  // invoice
  "invoice.created",
  "invoice.sent",
  "invoice.payment_received",
  "invoice.overdue",
  // payment-plan (avbetalningsplaner) — driver av påminnelser
  "payment.due",
  "payment.overdue",
  // time
  "time-entry.added",
  "time-entry.updated",
  "time-entry.deleted",
  // task
  "task.created",
  "task.completed",
  // rule / system
  "rule.executed",
  "rule.failed",
  "rule.claim_acquired",
  "rule.claim_released",
  "user.logged_in",
  "user.action",
  "system.heartbeat",
  "system.payment_scan_requested",
  "system.payment_scan_completed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const eventTypeSchema = z.enum(EVENT_TYPES);

export const eventSourceSchema = z.enum([
  "ui",
  "mail",
  "file",
  "rule",
  "system",
  "schedule",
]);

export type EventSource = z.infer<typeof eventSourceSchema>;

export const actorSchema = z.object({
  kind: z.enum(["user", "rule", "system"]),
  id: z.string().min(1),
});

export type Actor = z.infer<typeof actorSchema>;

/**
 * Eventet som det skrivs till loggen. `id` och `ts` sätts av writern;
 * resten skickas in av callern.
 */
export const avaEventSchema = z.object({
  /** UUID v7 — kronologiskt sorterbar (sätts av writern). */
  id: z.string().min(1),
  /** ISO 8601 timestamp (sätts av writern). */
  ts: z.string().datetime(),
  type: eventTypeSchema,
  source: eventSourceSchema,
  actor: actorSchema,
  /** Valfri primär kontext — fyll i när eventet gäller ett specifikt ärende. */
  matterId: z.string().optional(),
  /** Event-id som triggade detta. Bygger kausalkedjor mellan regler. */
  causedBy: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type AvaEvent = z.infer<typeof avaEventSchema>;

/** Vad caller faktiskt skickar in till `emitEvent`. */
export type EmitInput = Omit<AvaEvent, "id" | "ts">;

/**
 * Filter för event-frågor. Lägg till fält efterhand som vi behöver dem;
 * kombinationen är AND.
 */
export const eventFilterSchema = z.object({
  type: z.union([eventTypeSchema, z.array(eventTypeSchema)]).optional(),
  matterId: z.string().optional(),
  actorId: z.string().optional(),
  source: eventSourceSchema.optional(),
  /** ISO timestamp — events efter denna tid. */
  since: z.string().datetime().optional(),
  /** ISO timestamp — events före denna tid. */
  until: z.string().datetime().optional(),
  /** Max antal events att returnera. Default 1000. */
  limit: z.number().int().positive().max(10_000).optional(),
});

export type EventFilter = z.infer<typeof eventFilterSchema>;
