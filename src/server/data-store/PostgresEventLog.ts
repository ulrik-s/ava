/**
 * `PostgresEventLog` — `IEventLog`-implementation som persisterar
 * AVA-event-loggen i Postgres-tabellen `ava_event_log`.
 *
 * Använt av server-läget. I local-first-läget kommer en parallell
 * `FilesystemEventLog` implementera samma interface mot
 * `.ava/events/<år>/<mm>/<dd>.jsonl`-filer.
 *
 * Designval:
 *   - Skrivning är `INSERT` (Prisma `.create`). Append-only — vi har
 *     INGEN `update`/`delete` på events. Audit-historiken kompromettas
 *     annars.
 *   - Subscribers ringe i samma process. För cross-process subscribe
 *     (t.ex. SSE-broadcast till klienter) lägger vi LISTEN/NOTIFY
 *     senare — inte i denna första iteration.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { IEventLog } from "./IDataStore";
import {
  avaEventSchema,
  type AvaEvent,
  type EmitInput,
  type EventFilter,
} from "../events/schema";
import { uuidv7 } from "../events/uuid7";

type Listener = (event: AvaEvent) => void | Promise<void>;

export class PostgresEventLog implements IEventLog {
  private listeners: Set<Listener> = new Set();

  constructor(
    private prisma: PrismaClient,
    /** För multi-tenant. I local-first finns inte detta; där är repot tenant-grensen. */
    private organizationId: string,
  ) {}

  async emit(input: EmitInput): Promise<AvaEvent> {
    const event: AvaEvent = avaEventSchema.parse({
      id: uuidv7(),
      ts: new Date().toISOString(),
      ...input,
    });

    await this.prisma.avaEventLog.create({
      data: {
        id: event.id,
        type: event.type,
        source: event.source,
        actorKind: event.actor.kind,
        actorId: event.actor.id,
        organizationId: this.organizationId,
        matterId: event.matterId,
        causedBy: event.causedBy,
        payload: event.payload as Prisma.InputJsonValue,
        createdAt: new Date(event.ts),
      },
    });

    // Notifiera listeners synkront men i nästa tick så vi inte blockerar emit
    setImmediate(() => {
      for (const l of this.listeners) {
        try {
          void l(event);
        } catch (err) {
          // En trasig listener får inte ta ner emit-flödet
          console.error("[event-log] listener failed:", err);
        }
      }
    });

    return event;
  }

  async query(filter: EventFilter): Promise<AvaEvent[]> {
    const rows = await this.prisma.avaEventLog.findMany({
      where: this.buildWhere(filter),
      orderBy: { createdAt: "asc" },
      take: filter.limit ?? 1000,
    });
    return rows.map(this.rowToEvent);
  }

  async *iterate(filter: EventFilter): AsyncIterable<AvaEvent> {
    const batchSize = 500;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.avaEventLog.findMany({
        where: this.buildWhere(filter),
        orderBy: { id: "asc" },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return;
      for (const row of rows) yield this.rowToEvent(row);
      cursor = rows[rows.length - 1].id;
      if (rows.length < batchSize) return;
    }
  }

  onNewEvent(handler: Listener): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ─── helpers ─────────────────────────────────────────────────

  private buildWhere(filter: EventFilter) {
    const where: Record<string, unknown> = { organizationId: this.organizationId };
    if (filter.type) {
      where.type = Array.isArray(filter.type) ? { in: filter.type } : filter.type;
    }
    if (filter.matterId) where.matterId = filter.matterId;
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.source) where.source = filter.source;
    if (filter.since || filter.until) {
      where.createdAt = {};
      if (filter.since) (where.createdAt as Record<string, Date>).gte = new Date(filter.since);
      if (filter.until) (where.createdAt as Record<string, Date>).lte = new Date(filter.until);
    }
    return where;
  }

  private rowToEvent = (row: {
    id: string;
    type: string;
    source: string;
    actorKind: string;
    actorId: string;
    matterId: string | null;
    causedBy: string | null;
    payload: unknown;
    createdAt: Date;
  }): AvaEvent => ({
    id: row.id,
    ts: row.createdAt.toISOString(),
    type: row.type as AvaEvent["type"],
    source: row.source as AvaEvent["source"],
    actor: { kind: row.actorKind as AvaEvent["actor"]["kind"], id: row.actorId },
    matterId: row.matterId ?? undefined,
    causedBy: row.causedBy ?? undefined,
    payload: (row.payload as Record<string, unknown>) ?? {},
  });
}
