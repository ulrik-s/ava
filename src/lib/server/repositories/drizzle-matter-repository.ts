/**
 * Drizzle `MatterRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `matters.organizationId`. Listan/detaljen berikar
 * parter (KLIENT först) + relations-antal (`_count`) via grupperade sido-queries
 * (robustare än korrelerade subqueries; jfr document-folder-repo:t).
 */

import { and, asc, desc, eq, ilike, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import { containsPattern, prefixPattern } from "../db/like-pattern";
import { contacts, documents, matterContacts, matters, timeEntries } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, idsWhere, versionedTable } from "./drizzle-repository";
import {
  listPartiesOf, partiesByMatter,
  type MatterDetailRow, type MatterListFilter, type MatterListLink, type MatterListParty, type MatterListResult,
  type MatterListRow, type MatterRepository,
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
    const pat = f.search ? containsPattern(f.search) : "";
    return and(
      eq(matters.organizationId, organizationId),
      isNull(matters.deletedAt),
      f.status ? eq(matters.status, f.status) : undefined,
      f.employeeId
        ? sql`exists (select 1 from time_entries te where te.matter_id = ${matters.id} and te.user_id = ${f.employeeId})`
        : undefined,
      f.ids ? idsWhere(matters.id, f.ids) : undefined,
      f.search
        ? or(
            ilike(matters.title, pat),
            ilike(matters.matterNumber, pat),
            ilike(matters.courtCaseNumber, pat),
            ilike(matters.previousCourtCaseNumber, pat),
            ilike(matters.insuranceReference, pat),
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
    const [counts, parties] = await Promise.all([this.countsFor(ids), this.linksFor(organizationId, ids)]);
    const matterRows = rows.map((r): MatterListRow => ({
      ...r,
      ...listPartiesOf(parties.get(r.id) ?? []),
      _count: counts.get(r.id) ?? { documents: 0, timeEntries: 0, contacts: 0 },
    }));
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

  async listPartiesFor(organizationId: OrganizationId, matterIds: readonly MatterId[]): Promise<Map<MatterId, MatterListParty[]>> {
    return partiesByMatter(await this.linksFor(organizationId, matterIds));
  }

  /**
   * Kopplingarna (roll, kontaktens id+namn) per ärende-id i EN grupperad fråga,
   * org-scopad via join mot `matters` (mjukt raderade ärenden och kopplingar är
   * inte med), i `createdAt`-ordning. Källan för både listan och `listPartiesFor` (#1964).
   */
  private async linksFor(organizationId: OrganizationId, ids: readonly MatterId[]): Promise<Map<MatterId, MatterListLink[]>> {
    const out = new Map<MatterId, MatterListLink[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({ matterId: matterContacts.matterId, role: matterContacts.role, id: contacts.id, name: contacts.name })
      .from(matterContacts)
      .innerJoin(matters, eq(matterContacts.matterId, matters.id))
      .innerJoin(contacts, eq(matterContacts.contactId, contacts.id))
      .where(and(
        inArray(matterContacts.matterId, [...ids]),
        isNull(matterContacts.deletedAt),
        eq(matters.organizationId, organizationId),
        isNull(matters.deletedAt),
      ))
      .orderBy(asc(matterContacts.createdAt));
    for (const r of rows) {
      const links = out.get(r.matterId) ?? [];
      links.push({ role: r.role, contact: { id: r.id, name: r.name } });
      out.set(r.matterId, links);
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
        like(matters.matterNumber, prefixPattern(prefix)), // bokstavligt, som startsWith i minnesrepot (#1678)
        isNull(matters.deletedAt),
      ));
    return this.asRows(rows);
  }
}
