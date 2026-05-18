/**
 * `WriteThroughProjector` — kopplar event-loggen till `ProjectionWriter`
 * så att Prisma-writes automatiskt projiceras till JSON-filer.
 *
 * Flöde:
 *   1. Router gör `ctx.dataStore.matters.create(...)` (oförändrat)
 *   2. Router emittar event via `emit.matterCreated(...)` (oförändrat)
 *   3. `WriteThroughProjector` ser eventet i event-loggen
 *   4. Den läser tillbaka entiteten via dataStore-delegate
 *   5. `ProjectionWriter` skriver JSON till fil
 *
 * Designval (Open-closed):
 *   - Nya event-typer mappas i `eventHandlers`-tabellen utan ändring
 *     av executor-logiken.
 *
 * Designval (Single responsibility):
 *   - Den här klassen orkestrerar projektion. Den läser inte filer,
 *     skriver inte git, och utför inga side-effects utöver att kalla
 *     writern.
 *
 * Designval (Liskov + DI):
 *   - Beror på interfaces (`IEventLog`, `IDataStore`) — inte konkreta
 *     klasser. Funkar med PostgresStore (server-läget) och LocalGitStore
 *     (local-first-läget) identiskt.
 */

import type { IDataStore, IEventLog } from "../data-store/IDataStore";
import type { AvaEvent, EventType } from "../events/schema";
import type { ProjectionWriter } from "./projection-writer";

interface EventHandler {
  /** Entity-namnet i `ProjectionRegistry`. */
  entity: string;
  /** Är detta ett "ta bort"-event istället för "skapa/uppdatera"? */
  isDelete?: boolean;
  /** Extrahera id ur event-payloaden. */
  idOf: (event: AvaEvent) => string | null;
  /** Hämta entitet via dataStore. */
  fetch: (store: IDataStore, id: string) => Promise<unknown>;
}

const MATTER_HANDLER: EventHandler = {
  entity: "matter",
  idOf: (e) => e.matterId ?? (e.payload as { matterId?: string }).matterId ?? null,
  fetch: async (store, id) => store.matters.findUnique({ where: { id } }),
};

const CONTACT_HANDLER: EventHandler = {
  entity: "contact",
  idOf: (e) => (e.payload as { contactId?: string }).contactId ?? null,
  fetch: async (store, id) => store.contacts.findUnique({ where: { id } }),
};

const CONTACT_DELETE_HANDLER: EventHandler = {
  ...CONTACT_HANDLER,
  isDelete: true,
  // Vid radering har vi inte längre raden — vi behöver bara id för att
  // räkna ut path. Vi skapar en "stub" som har id-fältet satt så path:en
  // går att räkna fram av projektionen.
  fetch: async (_store, id) => ({ id }),
};

/**
 * Map från event-typ → hur man projicerar entiteten den refererar till.
 * Lägg till nya rader när nya event-typer introduceras.
 */
const EVENT_HANDLERS: Partial<Record<EventType, EventHandler>> = {
  "matter.created": MATTER_HANDLER,
  "matter.updated": MATTER_HANDLER,
  "matter.status_changed": MATTER_HANDLER,
  "matter.archived": MATTER_HANDLER,
  "contact.created": CONTACT_HANDLER,
  "contact.updated": CONTACT_HANDLER,
  "contact.deleted": CONTACT_DELETE_HANDLER,
};

export class WriteThroughProjector {
  constructor(
    private writer: ProjectionWriter,
    private store: IDataStore,
  ) {}

  /**
   * Fäst lyssnaren på event-loggen. Returnerar disposer.
   */
  attach(eventLog: IEventLog): () => void {
    return eventLog.onNewEvent(async (event) => {
      const handler = EVENT_HANDLERS[event.type];
      if (!handler) return;

      const id = handler.idOf(event);
      if (!id) return;

      try {
        const data = await handler.fetch(this.store, id);
        if (data == null) return;

        if (handler.isDelete) {
          await this.writer.remove(handler.entity, data);
        } else {
          await this.writer.project(handler.entity, data);
        }
      } catch (err) {
        console.error(
          `[write-through-projector] kunde inte projicera ${event.type} id=${id}:`,
          err,
        );
      }
    });
  }
}
