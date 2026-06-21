/**
 * Drizzle `OrganizationRepository` (ADR 0020) — endast bas-CRUD.
 */

import type { Organization } from "@/lib/shared/schemas/organization";
import { organizations } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { OrganizationRepository } from "./organization-repository";

export class DrizzleOrganizationRepository extends DrizzleRepository<Organization> implements OrganizationRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(organizations), now);
  }

  /**
   * Org-raden saknar `organizationId`-kolumn — den ÄR org:en. Utan override
   * härleder bas-`resolveOrg` ingen org → raden loggas aldrig i change_log →
   * synkas aldrig till klienten → `organization.getSettings` (organizations.
   * getById) hittar inget → "Laddar inställningar…" hänger (#653). Org:ens
   * egna `id` är dess org-scope.
   */
  protected override resolveOrg(row: unknown): string | undefined {
    return (row as { id?: string }).id;
  }
}
