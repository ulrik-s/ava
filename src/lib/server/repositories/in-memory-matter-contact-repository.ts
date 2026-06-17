/**
 * In-memory `MatterContactRepository` (ADR 0020) — browser/offline-impl.
 * Använder samma include som tidigare conflict-routern (contact + matter inkl.
 * KLIENT-kontakt); matterContacts-relations registrerade i relations.ts.
 */

import type { MatterContact } from "@/lib/shared/schemas/matter";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { ConflictContactRow, MatterContactRepository } from "./matter-contact-repository";

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
  constructor(store: MatterContactRepoSource, now?: () => Date) {
    super(store.matterContacts as unknown as Delegate, now ?? (() => new Date()));
  }

  async findForConflict(organizationId: string, numberTerm?: string): Promise<ConflictContactRow[]> {
    const where = numberTerm
      ? {
          matter: { organizationId },
          contact: { OR: [{ personalNumber: { contains: numberTerm } }, { orgNumber: { contains: numberTerm } }] },
        }
      : { matter: { organizationId } };
    return (await this.delegate.findMany({ where, include: MC_INCLUDE })) as ConflictContactRow[];
  }
}
