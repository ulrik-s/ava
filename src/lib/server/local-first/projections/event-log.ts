/**
 * `EventLogProjection` — projicerar ett `AvaEvent` till JSONL-loggen
 * `events/<år>/<mm>/<dd>.jsonl`.
 *
 * Time-bucketing från event-ts (inte från system-tid) så att replay
 * och cross-tidszon-frågor är deterministiska. Använder UTC för bucket-
 * boundary — undviker att samma event landar i olika filer beroende på
 * vem som klonar.
 *
 * DRY-not: bucketing-helpers (`pad2`, `bucketPath`) återanvänds av
 * `ClaimsProjection` med exakt samma struktur — extraherade till
 * `time-bucket.ts`.
 */

import { migrateEventPayload } from "@/lib/shared/schema-migrations";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";
import { avaEventSchema, type AvaEvent } from "../../events/schema";
import { JsonLinesProjection } from "./base";
import { dayBucketPath } from "./time-bucket";

export class EventLogProjection extends JsonLinesProjection<AvaEvent> {
  /**
   * @param repoSchemaVersion repots datamodell-version (ADR 0004). Event-
   *   payloads lyfts migrate-on-read från den upp till
   *   {@link CURRENT_SCHEMA_VERSION} vid läsning (#58). Default = CURRENT
   *   (ingen migration — för skrivvägen + repon i aktuell version).
   */
  constructor(private repoSchemaVersion: number = CURRENT_SCHEMA_VERSION) {
    super(avaEventSchema);
  }

  pathFor(event: AvaEvent): string {
    return dayBucketPath("events", new Date(event.ts));
  }

  /**
   * Parsa JSONL-raden och migrera payloaden till aktuell datamodell (#58).
   * Payloaden är fri `z.record` → migreringen körs EFTER parse (parse avvisar
   * aldrig payload-form). No-op när repot redan är i aktuell version.
   */
  override deserializeLine(raw: string): AvaEvent {
    const event = super.deserializeLine(raw);
    if (this.repoSchemaVersion >= CURRENT_SCHEMA_VERSION) return event;
    return { ...event, payload: migrateEventPayload(event.type, event.payload, this.repoSchemaVersion) };
  }
}
