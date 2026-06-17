/**
 * `OrganizationRepository` (ADR 0020, #409 fan-out) — organisationen är
 * rot-entiteten (själva scope:n), så ingen org-scoping. Endast bas-CRUD
 * (getById/create/update används av settings-vägen).
 */

import type { Organization } from "@/lib/shared/schemas/organization";
import type { Repository } from "./types";

export type OrganizationRepository = Repository<Organization>;
