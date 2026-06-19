/**
 * In-memory `ContactRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD;
 * list/detalj använder samma include som routern (query-engine resolvar _count +
 * nästlade relationer).
 */

import type { Contact } from "@/lib/shared/schemas/contact";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  ContactFull, ContactListOptions, ContactListResult, ContactListRow, ContactRepository,
} from "./contact-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type ContactRepoSource = Pick<IDataStore, "contacts">;

export class InMemoryContactRepository extends InMemoryRepository<Contact> implements ContactRepository {
  constructor(store: ContactRepoSource, now?: () => Date) {
    super(store.contacts, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: string, opts: ContactListOptions): Promise<ContactListResult> {
    const where = {
      organizationId,
      parentId: null,
      ...(opts.contactType ? { contactType: opts.contactType } : {}),
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, mode: "insensitive" as const } },
              { personalNumber: { contains: opts.search } },
              { orgNumber: { contains: opts.search } },
              { email: { contains: opts.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [contacts, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: { _count: { select: { matterLinks: true, children: true } } },
      }) as Promise<ContactListRow[]>,
      this.delegate.count({ where }),
    ]);
    return { contacts, total };
  }

  async getByIdFull(id: string, organizationId: string): Promise<ContactFull | null> {
    const row = (await this.delegate.findFirst({
      where: { id, organizationId },
      include: {
        children: { orderBy: { name: "asc" } },
        parent: { select: { id: true, name: true } },
        matterLinks: {
          orderBy: { createdAt: "desc" },
          include: { matter: { select: { id: true, matterNumber: true, title: true, status: true } } },
        },
      },
    })) as ContactFull | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async findByPersonalNumber(organizationId: string, personalNumber: string): Promise<Contact | null> {
    return (await this.delegate.findFirst({ where: { personalNumber, organizationId } })) as Contact | null;
  }

  async findByOrgNumber(organizationId: string, orgNumber: string): Promise<Contact | null> {
    return (await this.delegate.findFirst({ where: { orgNumber, organizationId } })) as Contact | null;
  }
}
