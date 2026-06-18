/**
 * Drizzle `ContactRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listForOrg` använder korrelerade subqueries för _count (matter-kopplingar +
 * barn) och `getByIdFull` sätter ihop detaljvyn via sekundär-queries.
 */

import { and, asc, desc, eq, ilike, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Contact } from "@/lib/shared/schemas/contact";
import { contacts, matterContacts, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  ContactFull, ContactListOptions, ContactListResult, ContactListRow, ContactRepository,
} from "./contact-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

export class DrizzleContactRepository extends DrizzleRepository<Contact> implements ContactRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(contacts), now);
  }

  async listForOrg(organizationId: string, opts: ContactListOptions): Promise<ContactListResult> {
    const where = and(
      eq(contacts.organizationId, organizationId),
      isNull(contacts.parentId), // bara topp-nivå
      isNull(contacts.deletedAt),
      opts.contactType ? eq(contacts.contactType, opts.contactType) : undefined,
      opts.search
        ? or(
            ilike(contacts.name, `%${opts.search}%`),
            like(contacts.personalNumber, `%${opts.search}%`),
            like(contacts.orgNumber, `%${opts.search}%`),
            ilike(contacts.email, `%${opts.search}%`),
          )
        : undefined,
    );
    const rows = await this.db
      .select().from(contacts)
      .where(where)
      .orderBy(asc(contacts.name))
      .limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)` }).from(contacts).where(where);
    // _count via grupperade frågor över sidans ids (robustare än korrelerade subqueries).
    const ids = rows.map((r) => (r as { id: string }).id);
    const linkCounts = await this.countBy(matterContacts, matterContacts.contactId, ids);
    const childCounts = await this.countBy(contacts, contacts.parentId, ids);
    return {
      contacts: rows.map((r) => {
        const id = (r as { id: string }).id;
        return {
          ...(r as object),
          _count: { matterLinks: linkCounts.get(id) ?? 0, children: childCounts.get(id) ?? 0 },
        };
      }) as unknown as ContactListRow[],
      total: Number(total),
    };
  }

  /** Antal rader i `table` grupperat på `column`, begränsat till `ids` → Map(id→antal). */
  private async countBy(table: PgTable, column: PgColumn, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ key: column, n: sql<number>`count(*)` })
      .from(table)
      .where(inArray(column, ids))
      .groupBy(column);
    return new Map(rows.map((r) => [String(r.key), Number(r.n)]));
  }

  async getByIdFull(id: string, organizationId: string): Promise<ContactFull | null> {
    const [c] = await this.db
      .select().from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!c) return null;
    const children = await this.db
      .select().from(contacts)
      .where(and(eq(contacts.parentId, id), isNull(contacts.deletedAt))).orderBy(asc(contacts.name));
    const parentId = (c as { parentId?: string | null }).parentId;
    const parentRows = parentId
      ? await this.db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.id, parentId)).limit(1)
      : [];
    const linkRows = await this.db
      .select({
        mc: matterContacts,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title, mStatus: matters.status,
      })
      .from(matterContacts)
      .innerJoin(matters, eq(matterContacts.matterId, matters.id)) // matterId NOT NULL FK → matter finns alltid
      .where(eq(matterContacts.contactId, id))
      .orderBy(desc(matterContacts.createdAt));
    return {
      ...(c as object),
      children: children as unknown as Contact[],
      parent: parentRows[0] ? { id: parentRows[0].id, name: parentRows[0].name as string } : null,
      matterLinks: linkRows.map((l) => ({
        ...(l.mc as object),
        matter: { id: l.mId, matterNumber: l.mNum as string, title: l.mTitle as string, status: l.mStatus as string },
      })),
    } as unknown as ContactFull;
  }

  async findByPersonalNumber(organizationId: string, personalNumber: string): Promise<Contact | null> {
    const rows = await this.db.select().from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.personalNumber, personalNumber), isNull(contacts.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as Contact | undefined) ?? null;
  }

  async findByOrgNumber(organizationId: string, orgNumber: string): Promise<Contact | null> {
    const rows = await this.db.select().from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.orgNumber, orgNumber), isNull(contacts.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as Contact | undefined) ?? null;
  }
}
