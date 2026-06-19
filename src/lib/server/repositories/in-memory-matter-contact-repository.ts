/**
 * In-memory `MatterContactRepository` (ADR 0020) — browser/offline-impl.
 * Använder samma include som tidigare conflict-routern (contact + matter inkl.
 * KLIENT-kontakt); matterContacts-relations registrerade i relations.ts.
 */

import type { Contact } from "@/lib/shared/schemas/contact";
import type { MatterContact } from "@/lib/shared/schemas/matter";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type {
  ConflictContactRow, MatterContactRepository, MatterContactWithContact,
} from "./matter-contact-repository";

export type MatterContactRepoSource = Pick<IDataStore, "matterContacts">;

const MC_INCLUDE = {
  contact: true,
  matter: {
    include: {
      contacts: { where: { role: "KLIENT" }, include: { contact: { select: { name: true } } }, take: 1 },
    },
  },
} as const;

export class InMemoryMatterContactRepository
  extends InMemoryRepository<MatterContact>
  implements MatterContactRepository {
  constructor(private readonly source: MatterContactRepoSource, now?: () => Date) {
    super(source.matterContacts, now ?? (() => new Date()));
  }

  async findForConflict(organizationId: string, numberTerm?: string): Promise<ConflictContactRow[]> {
    const where = numberTerm
      ? {
          matter: { organizationId },
          contact: { OR: [{ personalNumber: { contains: numberTerm } }, { orgNumber: { contains: numberTerm } }] },
        }
      : { matter: { organizationId } };
    const rows = await this.source.matterContacts.findMany({ where, include: MC_INCLUDE });
    // contact/matter joinas i runtime (MC_INCLUDE) men typas `unknown` av
    // JoinedRelations — narrowa varje join till jävskontroll-projektionen.
    return rows.map((r): ConflictContactRow => ({
      role: r.role,
      contact: r.contact as ConflictContactRow["contact"],
      matter: r.matter as ConflictContactRow["matter"],
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<MatterContact | null> {
    const row = (await this.delegate.findFirst({
      where: { id, matter: { organizationId } },
    })) as (MatterContact & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async linkContact(data: Partial<MatterContact>): Promise<MatterContactWithContact> {
    // create enrichar raden med contact (LocalStore.enrichRowForEntity) — den
    // körda raden är en MatterContactWithContact (smal subtyp-assertion).
    const row = await this.create(data);
    return row as MatterContactWithContact;
  }

  async findLink(matterId: string, contactId: string, role: string): Promise<MatterContact | null> {
    return (await this.delegate.findFirst({ where: { matterId, contactId, role } })) as MatterContact | null;
  }

  async listContactsForMatter(matterId: string): Promise<Contact[]> {
    const rows = (await this.delegate.findMany({
      where: { matterId }, include: { contact: true },
    })) as Array<{ contact: Contact }>;
    return rows.map((r) => r.contact).filter(Boolean);
  }
}
