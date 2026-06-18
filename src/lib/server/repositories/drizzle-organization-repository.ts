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
}
