/**
 * Drizzle `MatterContactRepository` (ADR 0020) — server-impl. Joinar kontakt +
 * ärende; KLIENT-namnet hämtas via korrelerad subquery (samma mönster som
 * tidsrapportens listForReport).
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterContact } from "@/lib/shared/schemas/matter";
import { contacts, matterContacts, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  ConflictContactRow, MatterContactRepository, MatterContactWithContact,
} from "./matter-contact-repository";

export class DrizzleMatterContactRepository
  extends DrizzleRepository<MatterContact>
  implements MatterContactRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(matterContacts), now);
  }

  async findForConflict(organizationId: string, numberTerm?: string): Promise<ConflictContactRow[]> {
    const klient = sql<string | null>`(select c.name from matter_contacts mc join contacts c on mc.contact_id = c.id where mc.matter_id = ${matters.id} and mc.role = 'KLIENT' limit 1)`;
    const numberFilter = numberTerm
      ? or(
          sql`${contacts.personalNumber} like ${"%" + numberTerm + "%"}`,
          sql`${contacts.orgNumber} like ${"%" + numberTerm + "%"}`,
        )
      : undefined;
    const rows = await this.db
      .select({
        role: matterContacts.role,
        cId: contacts.id, cName: contacts.name, cType: contacts.contactType,
        cPnr: contacts.personalNumber, cOrg: contacts.orgNumber,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title, klient,
      })
      .from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .innerJoin(matters, eq(matterContacts.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), isNull(matterContacts.deletedAt), numberFilter));
    return rows.map((r) => ({
      role: r.role as string,
      contact: {
        id: r.cId as string, name: r.cName as string, contactType: r.cType as string,
        personalNumber: (r.cPnr as string | null) ?? null, orgNumber: (r.cOrg as string | null) ?? null,
      },
      matter: {
        id: r.mId as string, matterNumber: r.mNum as string, title: r.mTitle as string,
        contacts: r.klient ? [{ contact: { name: r.klient as string } }] : [],
      },
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<MatterContact | null> {
    const rows = await this.db
      .select({ mc: matterContacts }).from(matterContacts)
      .innerJoin(matters, eq(matterContacts.matterId, matters.id))
      .where(and(eq(matterContacts.id, id), eq(matters.organizationId, organizationId), isNull(matterContacts.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]?.mc);
  }

  async linkContact(data: Partial<MatterContact>): Promise<MatterContactWithContact> {
    const link = await this.create(data);
    const [contact] = await this.db
      .select().from(contacts).where(eq(contacts.id, (link as { contactId: string }).contactId)).limit(1);
    return { ...(link as object), contact: contact as unknown as Contact } as MatterContactWithContact;
  }

  async findLink(matterId: string, contactId: string, role: string): Promise<MatterContact | null> {
    const rows = await this.db.select().from(matterContacts)
      .where(and(
        eq(matterContacts.matterId, matterId), eq(matterContacts.contactId, contactId),
        eq(matterContacts.role, role), isNull(matterContacts.deletedAt),
      )).limit(1);
    return this.asRow(rows[0]);
  }

  async listContactsForMatter(matterId: string): Promise<Contact[]> {
    const rows = await this.db
      .select({ contact: contacts }).from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(eq(matterContacts.matterId, matterId), isNull(matterContacts.deletedAt)));
    return rows.map((r) => r.contact as unknown as Contact);
  }
}
