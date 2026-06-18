/**
 * Drizzle `AccontoDeductionRepository` (ADR 0020) — server-impl. Endast bas-CRUD.
 */

import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import { accontoDeductions } from "../db/schema";
import type { AppDb } from "../db/types";
import type { AccontoDeductionRepository } from "./acconto-deduction-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

export class DrizzleAccontoDeductionRepository
  extends DrizzleRepository<AccontoDeduction>
  implements AccontoDeductionRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(accontoDeductions), now);
  }
}
