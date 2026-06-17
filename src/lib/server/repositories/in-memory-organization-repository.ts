/**
 * In-memory `OrganizationRepository` (ADR 0020) — endast bas-CRUD.
 */

import type { Organization } from "@/lib/shared/schemas/organization";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { OrganizationRepository } from "./organization-repository";

export type OrganizationRepoSource = Pick<IDataStore, "organizations">;

export class InMemoryOrganizationRepository extends InMemoryRepository<Organization> implements OrganizationRepository {
  constructor(store: OrganizationRepoSource, now?: () => Date) {
    super(store.organizations as unknown as Delegate, now ?? (() => new Date()));
  }
}
