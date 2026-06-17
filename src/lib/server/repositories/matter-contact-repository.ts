/**
 * `MatterContactRepository` (ADR 0020, #409 fan-out) — kontakt↔ärende-länkar.
 * Bas-CRUD ärvs. `findForConflict` driver jävskontrollen: kontakt + ärende
 * (inkl. KLIENT-kontaktens namn) org-scopat, valfritt nummer-filtrerat.
 */

import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterContact } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Länk + kontakten (det `matter.addContact`/`addNewContact` returnerar). */
export interface MatterContactWithContact extends MatterContact {
  contact: Contact;
}

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
  /** Länk by id, org-scopad via ärendet. Null om saknas/annan org/raderad. */
  getByIdInOrg(id: string, organizationId: string): Promise<MatterContact | null>;
  /** Skapa en länk och returnera den med kontakten (matter.addContact/addNewContact). */
  linkContact(data: Partial<MatterContact>): Promise<MatterContactWithContact>;
}
