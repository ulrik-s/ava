/**
 * Drizzle `ServiceNoteRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar via join mot ärendet, list left-joinar författaren.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { asId } from "@/lib/shared/schemas/ids";
import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import { matters, serviceNotes, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { ServiceNoteRepository, ServiceNoteRow } from "./service-note-repository";

export class DrizzleServiceNoteRepository extends DrizzleRepository<ServiceNote> implements ServiceNoteRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(serviceNotes), now);
  }

  async listByMatter(matterId: string, organizationId: string): Promise<ServiceNoteRow[]> {
    const rows = await this.db
      .select({ note: serviceNotes, aId: users.id, aName: users.name }).from(serviceNotes)
      .innerJoin(matters, eq(serviceNotes.matterId, matters.id))
      .leftJoin(users, eq(serviceNotes.authorId, users.id))
      .where(and(
        eq(serviceNotes.matterId, asId<"MatterId">(matterId)),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(serviceNotes.deletedAt),
      ))
      .orderBy(desc(serviceNotes.createdAt));
    return rows.map((r): ServiceNoteRow => ({
      ...r.note,
      author: r.aId ? { id: r.aId, name: r.aName ?? "" } : null,
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<ServiceNote | null> {
    const rows = await this.db
      .select({ note: serviceNotes }).from(serviceNotes)
      .innerJoin(matters, eq(serviceNotes.matterId, matters.id))
      .where(and(eq(serviceNotes.id, asId<"ServiceNoteId">(id)), eq(matters.organizationId, asId<"OrganizationId">(organizationId)), isNull(serviceNotes.deletedAt)))
      .limit(1);
    return rows[0]?.note ?? null;
  }
}
