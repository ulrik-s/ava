/**
 * Drizzle `MatterContactRepository` (ADR 0020) — server-impl. Joinar kontakt +
 * ärende; KLIENT-namnet hämtas via korrelerad subquery (samma mönster som
 * tidsrapportens listForReport).
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import type { ContactId, MatterContactId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { MatterContact } from "@/lib/shared/schemas/matter";
import { contacts, matterContacts, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  ConflictContactRow, MatterContactRepository, MatterContactWithContact,
} from "./matter-contact-repository";
import { matterOrg } from "./matter-org";

export class DrizzleMatterContactRepository
  extends DrizzleRepository<MatterContact>
  implements MatterContactRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(matterContacts), now);
  }

  /** matter_contacts saknar org-kolumn → härled via ärendet (#528/#632) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  async findForConflict(organizationId: OrganizationId, numberTerm?: string): Promise<ConflictContactRow[]> {
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
      role: r.role,
      contact: {
        id: r.cId, name: r.cName, contactType: r.cType,
        personalNumber: r.cPnr ?? null, orgNumber: r.cOrg ?? null,
      },
      matter: {
        id: r.mId, matterNumber: r.mNum, title: r.mTitle,
        contacts: r.klient ? [{ contact: { name: r.klient } }] : [],
      },
    }));
  }

  async getByIdInOrg(id: MatterContactId, organizationId: OrganizationId): Promise<MatterContact | null> {
    const rows = await this.db
      .select({ mc: matterContacts }).from(matterContacts)
      .innerJoin(matters, eq(matterContacts.matterId, matters.id))
      .where(and(eq(matterContacts.id, id), eq(matters.organizationId, organizationId), isNull(matterContacts.deletedAt)))
      .limit(1);
    return rows[0]?.mc ?? null;
  }

  async linkContact(data: Partial<MatterContact>): Promise<MatterContactWithContact> {
    const link = await this.create(data);
    const [contact] = await this.db
      .select().from(contacts).where(eq(contacts.id, link.contactId)).limit(1);
    return { ...link, contact: contact as Contact };
  }

  async findLink(matterId: MatterId, contactId: ContactId, role: string): Promise<MatterContact | null> {
    const rows = await this.db.select().from(matterContacts)
      .where(and(
        eq(matterContacts.matterId, matterId), eq(matterContacts.contactId, contactId),
        eq(matterContacts.role, role as MatterRole), isNull(matterContacts.deletedAt),
      )).limit(1);
    return rows[0] ?? null;
  }

  async listContactsForMatter(matterId: MatterId): Promise<Contact[]> {
    const rows = await this.db
      .select({ contact: contacts }).from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(eq(matterContacts.matterId, matterId), isNull(matterContacts.deletedAt)));
    return rows.map((r) => r.contact);
  }
}
