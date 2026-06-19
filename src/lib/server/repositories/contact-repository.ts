/**
 * `ContactRepository` (ADR 0020, #409 fan-out) — kontakter (klienter/motparter/
 * domstolar m.m.). Bas-CRUD ärvs; `listForOrg` ger topp-nivå-listan med
 * relations-antal (_count) och `getByIdFull` hela detaljvyn (barn/förälder/
 * ärende-kopplingar). Org-scopas direkt på `organizationId`.
 */

import type { Contact } from "@/lib/shared/schemas/contact";
import type { ContactType } from "@/lib/shared/schemas/enums";
import type { Repository } from "./types";

/** Kontakt + antal relationer (listvyns _count). */
export interface ContactListRow extends Contact {
  _count: { matterLinks: number; children: number };
}

/** En ärende-koppling med ärendets sammanfattning (detaljvyns matterLinks). */
export interface ContactMatterLink {
  id: string;
  matterId: string;
  contactId: string;
  role: string;
  notes: string | null;
  /** Alltid satt — `matterId` är NOT NULL FK, så ärendet finns alltid. */
  matter: { id: string; matterNumber: string; title: string; status: string };
}

/** Full kontakt-detalj (motsvarar `contact.getById`-routerns include). */
export interface ContactFull extends Contact {
  children: Contact[];
  parent: { id: string; name: string } | null;
  matterLinks: ContactMatterLink[];
}

/** Filter/paginering för `listForOrg`. */
export interface ContactListOptions {
  search?: string | undefined;
  contactType?: ContactType | undefined;
  page: number;
  pageSize: number;
}

export interface ContactListResult {
  contacts: ContactListRow[];
  total: number;
}

export interface ContactRepository extends Repository<Contact> {
  /** Topp-nivå-kontakter (parentId null) i org:en, paginerat + sökbart, med _count. */
  listForOrg(organizationId: string, opts: ContactListOptions): Promise<ContactListResult>;
  /** Full kontakt-detalj (barn/förälder/ärende-kopplingar), org-scopad. Null om saknas/raderad. */
  getByIdFull(id: string, organizationId: string): Promise<ContactFull | null>;
  /** Kontakt med givet personnummer i org:en (dedup). Null om ingen. */
  findByPersonalNumber(organizationId: string, personalNumber: string): Promise<Contact | null>;
  /** Kontakt med givet org-nummer i org:en (dedup). Null om ingen. */
  findByOrgNumber(organizationId: string, orgNumber: string): Promise<Contact | null>;
}
