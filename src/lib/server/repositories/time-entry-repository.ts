/**
 * `TimeEntryRepository` (ADR 0020, #409 fan-out) — tidsposter. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade poster (med juristens timtaxa för
 * fakturaberäkningen) och `flagBilled` kopplar dem till fakturan (bulk).
 */

import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

/** Tidspost + juristens timtaxa (det fakturaberäkningen behöver). */
export interface UnbilledTimeEntry extends TimeEntry {
  user: { hourlyRate: number | null };
}

export interface TimeEntryRepository extends Repository<TimeEntry> {
  /** Valda ofakturerade tidsposter i ett ärende (med user.hourlyRate). Tom lista vid tomma ids. */
  listUnbilled(matterId: string, ids: string[]): Promise<UnbilledTimeEntry[]>;
  /** Koppla tidsposter till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: string[], invoiceId: string): Promise<void>;
}
