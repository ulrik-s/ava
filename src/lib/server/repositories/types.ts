/**
 * Repository-sömmens kontrakt (ADR 0020) — ersätter stegvis den Prisma-formade
 * `IDataStore`. Per-entitet-repositories exponerar EXPLICITA, TYPADE metoder i
 * stället för dynamiska `where`/`include`-objekt; varje backend (Drizzle på
 * servern, in-memory i browsern/offline) implementerar samma typade metoder.
 *
 * Fas 1 (#409) lägger fundamentet: bas-kontrakten + en in-memory-bas som
 * delegerar till den befintliga query-engine/LocalStore (ingen spilld kod).
 * Entitets-repositories + Drizzle-impl följer per-entitet (fan-out).
 */

/** Minsta form en repository-rad har (reconcile-konventioner, ADR 0017/0019). */
export interface RowBase {
  id: string;
  version?: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  deletedAt?: Date | string | null;
}

/**
 * Bas-CRUD som varje entitets-repository ärver. Entiteter LÄGGER TILL egna
 * typade metoder (t.ex. `invoices.getByIdWithLedger`, `matters.listByOrg`) —
 * inga dynamiska arg-objekt.
 */
export interface Repository<Row extends RowBase> {
  getById(id: string): Promise<Row | null>;
  getByIdOrThrow(id: string): Promise<Row>;
  create(data: Partial<Row>): Promise<Row>;
  update(id: string, patch: Partial<Row>): Promise<Row>;
  /**
   * Uppdatera metadata UTAN att bumpa `version`. `version` är radens
   * INNEHÅLLS-version (för dokument: ADR 0023) — den bumpas BARA av faktiska
   * innehållsändringar (`uploadContent`, extern redigering). Metadata-
   * skrivningar (AI-klassificering, taggar, titel, summary) ändrar innehållet
   * INTE och får därför inte bumpa versionen. `updatedAt` uppdateras dock
   * fortfarande (radens senaste skrivning), och ändringen delta-synkas som vanligt.
   */
  updateMetadata(id: string, patch: Partial<Row>): Promise<Row>;
  /** Mjuk delete (sätter `deletedAt`, bumpar `version`) — tombstone, ADR 0017. */
  softDelete(id: string): Promise<Row>;
  /**
   * Hård delete (tar bort raden helt). MEDVETEN ADR 0017-undantag: en hård
   * delete kan inte reconcile:as/replikeras (raden bara försvinner). Använd
   * BARA där en unik-constraint kräver det (t.ex. PaymentPlan.invoiceId @unique
   * när en gammal CANCELLED-plan måste ge plats åt en ny). Default = softDelete.
   */
  hardDelete(id: string): Promise<void>;
}
