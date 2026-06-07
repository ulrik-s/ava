/**
 * `FilesystemEventLog` — `IEventLog`-implementation som persisterar events
 * till JSONL-filer i git working tree.
 *
 * Filplacering: `events/<yyyy>/<mm>/<dd>.jsonl`, en rad per event.
 *
 * Designval (Single responsibility):
 *   - Den här klassen vet bara om att skriva och läsa events. Den vet
 *     ingenting om git eller sync — det är `LocalGitStore`s ansvar.
 *   - `query()` iterar dagligen-buckets från senaste till äldsta.
 *     Sparse-checkout-vinster realiseras genom att äldre buckets är
 *     frånvarande från working tree (det är ett "miss" som returnerar
 *     tomt, inte ett fel).
 *
 * Designval (Liskov):
 *   - Samma `IEventLog`-kontrakt som `PostgresEventLog`. Skiljt
 *     beteende: query-ordningen är garanterat kronologisk via UUID v7.
 */

import type { IEventLog } from "../data-store/IDataStore";
import {
  avaEventSchema,
  type AvaEvent,
  type EmitInput,
  type EventFilter,
} from "../events/schema";
import { uuidv7 } from "../events/uuid7";
import type { IFileSystem } from "./file-system";
import { EventLogProjection } from "./projections/event-log";

type Listener = (event: AvaEvent) => void | Promise<void>;

export class FilesystemEventLog implements IEventLog {
  private projection: EventLogProjection;
  private listeners: Set<Listener> = new Set();

  /**
   * @param repoSchemaVersion repots datamodell-version (ADR 0004) för
   *   migrate-on-read av äldre event-payloads vid läsning (#58). Default =
   *   CURRENT (ingen migration).
   */
  constructor(private fs: IFileSystem, repoSchemaVersion?: number) {
    this.projection = new EventLogProjection(repoSchemaVersion);
  }

  async emit(input: EmitInput): Promise<AvaEvent> {
    const event: AvaEvent = avaEventSchema.parse({
      id: uuidv7(),
      ts: new Date().toISOString(),
      ...input,
    });

    const path = this.projection.pathFor(event);
    await this.fs.appendFile(path, this.projection.serializeLine(event) + "\n");

    // Notifiera listeners i nästa tick — håller emit() icke-blockerande
    // för subscriber-side-effects.
    setImmediate(() => {
      for (const l of this.listeners) {
        try { void l(event); } catch (err) {
          console.error("[fs-event-log] listener kraschade:", err);
        }
      }
    });

    return event;
  }

  async query(filter: EventFilter): Promise<AvaEvent[]> {
    const results: AvaEvent[] = [];
    const limit = filter.limit ?? 1000;

    for await (const event of this.iterate(filter)) {
      results.push(event);
      if (results.length >= limit) break;
    }
    return results;
  }

  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async generator method 'iterate' has a complexity of 10. Maximum allowed is 8.)
  async *iterate(filter: EventFilter): AsyncIterable<AvaEvent> {
    // För nu: linjär scan över alla års-mappar (sorterade lex). Optimering
    // (slice efter `since/until`) kommer när vi har realistisk last.
    const years = (await this.fs.listDir("events")).sort();
    for (const year of years) {
      const months = (await this.fs.listDir(`events/${year}`)).sort();
      for (const month of months) {
        const days = (await this.fs.listDir(`events/${year}/${month}`)).sort();
        for (const day of days) {
          if (!day.endsWith(".jsonl")) continue;
          const path = `events/${year}/${month}/${day}`;
          let content: string;
          try { content = await this.fs.readFile(path); } catch { continue; }
          for (const line of content.split("\n")) {
            if (!line) continue;
            let event: AvaEvent;
            try { event = this.projection.deserializeLine(line); } catch { continue; }
            if (this.matches(event, filter)) yield event;
          }
        }
      }
    }
  }

  onNewEvent(handler: Listener): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ── intern matching (delar logik med PostgresEventLog) ─────────

  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Method 'matches' has a complexity of 14. Maximum allowed is 8.)
  private matches(event: AvaEvent, filter: EventFilter): boolean {
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(event.type)) return false;
    }
    if (filter.matterId && event.matterId !== filter.matterId) return false;
    if (filter.actorId && event.actor.id !== filter.actorId) return false;
    if (filter.source && event.source !== filter.source) return false;
    if (filter.since && event.ts < filter.since) return false;
    if (filter.until && event.ts > filter.until) return false;
    return true;
  }
}
