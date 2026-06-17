/**
 * `MatterContactRepository` (ADR 0020, #409 fan-out) — kontakt↔ärende-länkar.
 * Bas-CRUD ärvs. `findForConflict` driver jävskontrollen: kontakt + ärende
 * (inkl. KLIENT-kontaktens namn) org-scopat, valfritt nummer-filtrerat.
 */

import type { MatterContact } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Jävskontroll-rad: länk + kontakt + ärende (med KLIENT-namn). */
export interface ConflictContactRow {
  role: string;
  contact: {
    id: string; name: string; contactType: string;
    personalNumber: string | null; orgNumber: string | null;
  };
  matter: {
    id: string; matterNumber: string; title: string;
    contacts: Array<{ contact: { name: string } }>;
  };
}

export interface MatterContactRepository extends Repository<MatterContact> {
  /**
   * Länkar i org:en med kontakt + ärende (KLIENT-namn). `numberTerm` (om satt)
   * filtrerar på contact.personalNumber/orgNumber (delsträng); annars alla
   * (namn-fuzzy görs i routern).
   */
  findForConflict(organizationId: string, numberTerm?: string): Promise<ConflictContactRow[]>;
}
