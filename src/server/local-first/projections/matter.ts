/**
 * `MatterProjection` — projicierar en matter till git working tree.
 *
 * Filplacering:
 *   - ACTIVE / CLOSED  → `matters/active/<id>.json`
 *   - ARCHIVED         → `matters/archive/<år>/<id>.json`
 *
 * Arkiverings-året tas från `archivedAt`. Saknas tidsstämpel hamnar filen
 * under `matters/archive/unknown/` — markerar för admin att fixa upp datat.
 *
 * Designval: vi splittar inte CLOSED från ACTIVE i filsystemet eftersom
 * stängda ärenden ofta återöppnas (kund får ny fråga, behöver kommentar).
 * Arkivering är det "definitiva slutet" — då tar vi sparse-checkout-vinsten.
 */

import { z } from "zod";
import { JsonProjection } from "./base";

export const matterProjectionSchema = z.object({
  id: z.string().min(1),
  matterNumber: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]),
  organizationId: z.string(),
  archivedAt: z.string().nullable().optional(),
});

export type MatterProjectionData = z.infer<typeof matterProjectionSchema>;

export class MatterProjection extends JsonProjection<MatterProjectionData> {
  constructor() { super(matterProjectionSchema); }

  pathFor(m: MatterProjectionData): string {
    if (m.status !== "ARCHIVED") {
      return `matters/active/${m.id}.json`;
    }
    const year = m.archivedAt ? new Date(m.archivedAt).getUTCFullYear() : "unknown";
    return `matters/archive/${year}/${m.id}.json`;
  }
}
