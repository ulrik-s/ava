/**
 * `GenericProjection` — passthrough-projektion för entiteter där vi inte
 * behöver schema-validering vid hydration (data:n valideras redan av
 * tRPC-routrarnas zod-input och DemoDataStore:s ENTITY_REGISTRY).
 *
 * Användning: registrera entiteter som inte har en specifik
 * projection-klass (t.ex. calendarEvent, paymentPlan, task) via denna.
 *
 * Inga obligatoriska fält → tom z.object().passthrough() behåller allt.
 */

import { z } from "zod";
import { JsonProjection } from "./base";

const passthroughSchema = z.object({ id: z.string().min(1) }).passthrough();

export class GenericProjection extends JsonProjection<{ id: string } & Record<string, unknown>> {
  constructor(private readonly pathPrefix: string) {
    super(passthroughSchema);
  }

  pathFor(input: { id: string }): string {
    return `${this.pathPrefix}/${input.id}.json`;
  }
}
