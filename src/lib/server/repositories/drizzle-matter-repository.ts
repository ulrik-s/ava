/**
 * Drizzle `MatterRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `matters.organizationId`. Listan/detaljen berikar
 * KLIENT-kontakt + relations-antal (`_count`) via grupperade sido-queries
 * (robustare än korrelerade subqueries; jfr document-folder-repo:t).
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { asId } from "@/lib/shared/schemas/ids";
import type { Matter, MatterContact } from "@/lib/shared/schemas/matter";
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

  async getByIdInOrg(id: string, organizationId: string): Promise<Matter | null> {
    const rows = await this.db
      .select().from(matters)
      .where(and(eq(matters.id, id), eq(matters.organizationId, organizationId), isNull(matters.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }

  async listByOrg(organizationId: string): Promise<Matter[]> {
    const rows = await this.db
      .select().from(matters)
      .where(and(eq(matters.organizationId, organizationId), isNull(matters.deletedAt)));
    return this.asRows(rows);
  }

  private listWhere(organizationId: string, f: MatterListFilter) {
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

  async listForOrg(organizationId: string, filter: MatterListFilter): Promise<MatterListResult> {
    const where = this.listWhere(organizationId, filter);
    const rows = await this.db.select().from(matters).where(where)
      .orderBy(desc(matters.createdAt))
      .limit(filter.pageSize).offset((filter.page - 1) * filter.pageSize);
    const [agg] = await this.db.select({ total: sql<number>`count(*)` }).from(matters).where(where);
    const ids = rows.map((r) => (r as { id: string }).id);
    const [counts, klient] = await Promise.all([this.countsFor(ids), this.klientFor(ids)]);
    const matterRows = rows.map((r) => {
      const id = (r as { id: string }).id;
      const k = klient.get(id);
      return {
        ...(r as object),
        contacts: k ? [{ contact: k }] : [],
        _count: counts.get(id) ?? { documents: 0, timeEntries: 0, contacts: 0 },
      };
    }) as unknown as MatterListRow[];
    return { matters: matterRows, total: Number(agg?.total ?? 0) };
  }

  /** Grupperade relations-antal per ärende-id (documents/timeEntries/contacts). */
  private async countsFor(ids: string[]): Promise<Map<string, { documents: number; timeEntries: number; contacts: number }>> {
    const out = new Map<string, { documents: number; timeEntries: number; contacts: number }>();
    if (ids.length === 0) return out;
    for (const id of ids) out.set(id, { documents: 0, timeEntries: 0, contacts: 0 });
    const apply = (rows: Array<{ id: unknown; n: number }>, key: "documents" | "timeEntries" | "contacts") => {
      for (const r of rows) { const cur = r.id ? out.get(r.id as string) : undefined; if (cur) cur[key] = Number(r.n); }
    };
    const [docs, tes, mcs] = await Promise.all([
      this.db.select({ id: documents.matterId, n: sql<number>`count(*)` }).from(documents)
        .where(and(inArray(documents.matterId, ids.map((i) => asId<"MatterId">(i))), isNull(documents.deletedAt))).groupBy(documents.matterId),
      this.db.select({ id: timeEntries.matterId, n: sql<number>`count(*)` }).from(timeEntries)
        .where(and(inArray(timeEntries.matterId, ids.map((i) => asId<"MatterId">(i))), isNull(timeEntries.deletedAt))).groupBy(timeEntries.matterId),
      this.db.select({ id: matterContacts.matterId, n: sql<number>`count(*)` }).from(matterContacts)
        .where(and(inArray(matterContacts.matterId, ids), isNull(matterContacts.deletedAt))).groupBy(matterContacts.matterId),
    ]);
    apply(docs, "documents");
    apply(tes, "timeEntries");
    apply(mcs, "contacts");
    return out;
  }

  /** KLIENT-kontakt (id+namn) per ärende-id (första). */
  private async klientFor(ids: string[]): Promise<Map<string, { id: string; name: string }>> {
    const out = new Map<string, { id: string; name: string }>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({ matterId: matterContacts.matterId, cId: contacts.id, cName: contacts.name })
      .from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(inArray(matterContacts.matterId, ids), eq(matterContacts.role, "KLIENT")));
    for (const r of rows) {
      const mid = r.matterId as string;
      if (!out.has(mid)) out.set(mid, { id: r.cId as string, name: r.cName as string });
    }
    return out;
  }

  async getByIdWithContacts(id: string, organizationId: string): Promise<MatterDetailRow | null> {
    const base = await this.getByIdInOrg(id, organizationId);
    if (!base) return null;
    const rows = await this.db
      .select({ mc: matterContacts, contact: contacts })
      .from(matterContacts)
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(eq(matterContacts.matterId, id), isNull(matterContacts.deletedAt)))
      .orderBy(asc(matterContacts.createdAt));
    const linkContacts = rows.map((r) => ({ ...(r.mc as object), contact: r.contact })) as unknown as MatterContact[];
    const counts = (await this.countsFor([id])).get(id) ?? { documents: 0, timeEntries: 0, contacts: 0 };
    return {
      ...(base as object),
      contacts: linkContacts,
      _count: { documents: counts.documents, timeEntries: counts.timeEntries, emails: 0 },
    } as unknown as MatterDetailRow;
  }

  async listByResponsibleLawyer(organizationId: string, responsibleLawyerId: string): Promise<Matter[]> {
    const rows = await this.db.select().from(matters)
      .where(and(
        eq(matters.organizationId, organizationId),
        eq(matters.responsibleLawyerId, responsibleLawyerId),
        isNull(matters.deletedAt),
      ));
    return this.asRows(rows);
  }

  async listByNumberPrefix(organizationId: string, prefix: string): Promise<Matter[]> {
    const rows = await this.db.select().from(matters)
      .where(and(
        eq(matters.organizationId, organizationId),
        ilike(matters.matterNumber, `${prefix}%`),
        isNull(matters.deletedAt),
      ));
    return this.asRows(rows);
  }
}
