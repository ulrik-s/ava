/**
 * Drizzle `ServiceNoteRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar via join mot ärendet, list left-joinar författaren.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { MatterId, OrganizationId, ServiceNoteId } from "@/lib/shared/schemas/ids";
import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import { matters, serviceNotes, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { ServiceNoteRepository, ServiceNoteRow } from "./service-note-repository";

export class DrizzleServiceNoteRepository extends DrizzleRepository<ServiceNote> implements ServiceNoteRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(serviceNotes), now);
  }

  async listByMatter(matterId: MatterId, organizationId: OrganizationId): Promise<ServiceNoteRow[]> {
    const rows = await this.db
      .select({ note: serviceNotes, aId: users.id, aName: users.name }).from(serviceNotes)
      .innerJoin(matters, eq(serviceNotes.matterId, matters.id))
      .leftJoin(users, eq(serviceNotes.authorId, users.id))
      .where(and(
        eq(serviceNotes.matterId, matterId),
        eq(matters.organizationId, organizationId),
        isNull(serviceNotes.deletedAt),
      ))
      .orderBy(desc(serviceNotes.createdAt));
    return rows.map((r): ServiceNoteRow => ({
      ...r.note,
      author: r.aId ? { id: r.aId, name: r.aName ?? "" } : null,
    }));
  }

  async getByIdInOrg(id: ServiceNoteId, organizationId: OrganizationId): Promise<ServiceNote | null> {
    const rows = await this.db
      .select({ note: serviceNotes }).from(serviceNotes)
      .innerJoin(matters, eq(serviceNotes.matterId, matters.id))
      .where(and(eq(serviceNotes.id, id), eq(matters.organizationId, organizationId), isNull(serviceNotes.deletedAt)))
      .limit(1);
    return rows[0]?.note ?? null;
  }
}
