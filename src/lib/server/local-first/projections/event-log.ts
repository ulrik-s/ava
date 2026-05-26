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

import { avaEventSchema, type AvaEvent } from "../../events/schema";
import { JsonLinesProjection } from "./base";
import { dayBucketPath } from "./time-bucket";

export class EventLogProjection extends JsonLinesProjection<AvaEvent> {
  constructor() { super(avaEventSchema); }

  pathFor(event: AvaEvent): string {
    return dayBucketPath("events", new Date(event.ts));
  }
}
