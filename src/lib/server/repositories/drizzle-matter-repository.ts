/**
 * Drizzle `MatterRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `matters.organizationId`. Listan/detaljen berikar
 * KLIENT-kontakt + relations-antal (`_count`) via grupperade sido-queries
 * (robustare än korrelerade subqueries; jfr document-folder-repo:t).
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { ContactId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { contacts, documents, matterContacts, matters, timeEntries } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  MatterDetailRow, MatterListFilter, MatterListResult, MatterListRow, MatterRepository,
} from "./matter-repository";

export class DrizzleMatterRepository extends DrizzleRepository<Matter> implements MatterRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(matters), now);
  }

  async getByIdInOrg(id: MatterId, organizationId: OrganizationId): Promise<Matter | null> {
    const rows = await this.db
      .select().from(matters)
      .where(and(eq(matters.id, id), eq(matters.organizationId, organizationId), isNull(matters.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }

  async listByOrg(organizationId: OrganizationId): Promise<Matter[]> {
    const rows = await this.db
      .select().from(matters)
      .where(and(eq(matters.organizationId, organizationId), isNull(matters.deletedAt)));
    return this.asRows(rows);
  }

  private listWhere(organizationId: OrganizationId, f: MatterListFilter) {
    const pat = f.search ? `%${f.search}%` : "";
    return and(
      eq(matters.organizationId, organizationId),
      isNull(matters.deletedAt),
      f.status ? eq(matters.status, f.status) : undefined,
      f.employeeId
        ? sql`exists (select 1 from time_entries te where te.matter_id = ${matters.id} and te.user_id = ${f.employeeId})`
        : undefined,
      f.search
        ? or(
            ilike(matters.title, pat),
            ilike(matters.matterNumber, pat),
            sql`exists (select 1 from matter_contacts mc join contacts c on mc.contact_id = c.id where mc.matter_id = ${matters.id} and c.name ilike ${pat})`,
          )
        : undefined,
    );
  }

  async listForOrg(organizationId: OrganizationId, filter: MatterListFilter): Promise<MatterListResult> {
    const where = this.listWhere(organizationId, filter);
    const rows = await this.db.select().from(matters).where(where)
      .orderBy(desc(matters.createdAt))
      .limit(filter.pageSize).offset((filter.page - 1) * filter.pageSize);
    const [agg] = await this.db.select({ total: sql<number>`count(*)` }).from(matters).where(where);
    const ids = rows.map((r) => r.id);
    const [counts, klient] = await Promise.all([this.countsFor(ids), this.klientFor(ids)]);
    const matterRows = rows.map((r): MatterListRow => {
      const k = klient.get(r.id);
      return {
        ...r,
        contacts: k ? [{ contact: k }] : [],
        _count: counts.get(r.id) ?? { documents: 0, timeEntries: 0, contacts: 0 },
      };
    });
    return { matters: matterRows, total: Number(agg?.total ?? 0) };
  }

  /** Grupperade relations-antal per ärende-id (documents/timeEntries/contacts). */
  private async countsFor(ids: MatterId[]): Promise<Map<string, { documents: number; timeEntries: number; contacts: number }>> {
    const out = new Map<string, { documents: number; timeEntries: number; contacts: number }>();
    if (ids.length === 0) return out;
    for (const id of ids) out.set(id, { documents: 0, timeEntries: 0, contacts: 0 });
    const apply = (rows: Array<{ id: unknown; n: number }>, key: "documents" | "timeEntries" | "contacts") => {
      for (const r of rows) { const cur = r.id ? out.get(r.id as string) : undefined; if (cur) cur[key] = Number(r.n); }
    };
    const [docs, tes, mcs] = await Promise.all([
      this.db.select({ id: documents.matterId, n: sql<number>`count(*)` }).from(documents)
        .where(and(inArray(documents.matterId, ids), isNull(documents.deletedAt))).groupBy(documents.matterId),
      this.db.select({ id: timeEntries.matterId, n: sql<number>`count(*)` }).from(timeEntries)
        .where(and(inArray(timeEntries.matterId, ids), isNull(timeEntries.deletedAt))).groupBy(timeEntries.matterId),
      this.db.select({ id: matterContacts.matterId, n: sql<number>`count(*)` }).from(matterContacts)
        .where(and(inArray(matterContacts.matterId, ids), isNull(matterContacts.deletedAt))).groupBy(matterContacts.matterId),
    ]);
    apply(docs, "documents");
    apply(tes, "timeEntries");
    apply(mcs, "contacts");
    return out;
  }

  /** KLIENT-kontakt (id+namn) per ärende-id (första). */
  private async klientFor(ids: MatterId[]): Promise<Map<string, { id: ContactId; name: string }>> {
    const out = new Map<string, { id: ContactId; name: string }>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({ matterId: matterContacts.matterId, cId: contacts.id, cName: contacts.name })
      .from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(inArray(matterContacts.matterId, ids), eq(matterContacts.role, "KLIENT")));
    for (const r of rows) {
      const mid = r.matterId;
      if (!out.has(mid)) out.set(mid, { id: r.cId, name: r.cName });
    }
    return out;
  }

  async getByIdWithContacts(id: MatterId, organizationId: OrganizationId): Promise<MatterDetailRow | null> {
    const base = await this.getByIdInOrg(id, organizationId);
    if (!base) return null;
    const rows = await this.db
      .select({ mc: matterContacts, contact: contacts })
      .from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(eq(matterContacts.matterId, id), isNull(matterContacts.deletedAt)))
      .orderBy(asc(matterContacts.createdAt));
    const linkContacts = rows.map((r) => ({ ...r.mc, contact: r.contact }));
    const counts = (await this.countsFor([id])).get(id) ?? { documents: 0, timeEntries: 0, contacts: 0 };
    return {
      ...base,
      contacts: linkContacts,
      _count: { documents: counts.documents, timeEntries: counts.timeEntries, emails: 0 },
    };
  }

  async listByResponsibleLawyer(organizationId: OrganizationId, responsibleLawyerId: UserId): Promise<Matter[]> {
    const rows = await this.db.select().from(matters)
      .where(and(
        eq(matters.organizationId, organizationId),
        eq(matters.responsibleLawyerId, responsibleLawyerId),
        isNull(matters.deletedAt),
      ));
    return this.asRows(rows);
  }

  async listByNumberPrefix(organizationId: OrganizationId, prefix: string): Promise<Matter[]> {
    const rows = await this.db.select().from(matters)
      .where(and(
        eq(matters.organizationId, organizationId),
        ilike(matters.matterNumber, `${prefix}%`),
        isNull(matters.deletedAt),
      ));
    return this.asRows(rows);
  }
}
