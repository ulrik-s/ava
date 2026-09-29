/**
 * Entitet → repo för sync-bryggan (#sync-bridge, ADR 0017) och procedur-
 * omkörningen (#1276). Den dynamiska dispatchen (entitetsnamn → repo-fält)
 * finns på ett ställe.
 */

import { SOURCE_KEY_BY_ENTITY } from "../data-store/in-memory/entity-source-keys";
import type { Repositories } from "../repositories/repositories";

/** En rad i den strukturella formen sync-bryggan hanterar. */
export type Row = Record<string, unknown>;

/**
 * Den heterogena delmängd av en entitets-repo som sync-bryggan kallar, typad mot
 * den strukturella rad-formen (`Record<string, unknown>`) i st.f. en specifik
 * entitet. Domän-rad-typerna (zod `.passthrough()`) bär en index-signatur och är
 * därför tilldelningsbara hit — så varje `Repository<Domän>` uppfyller `EntityRepo`
 * (metod-bivarians på param + kovariant retur via index-signaturen). Det låter
 * `entityRepo` returnera en TYPAD repo utan rad-castar nedströms.
 */
export interface EntityRepo {
  getById(id: string): Promise<Row | null>;
  create(data: Row): Promise<Row>;
  update(id: string, patch: Row): Promise<Row>;
  softDelete(id: string): Promise<Row>;
  organizationOf(row: Row): Promise<string | undefined>;
}

/** Repo-nycklarna i registret (alla fält utom `transaction`). */
type RepoKey = keyof Omit<Repositories, "transaction">;

/** Repot för en entitet, eller `null` om entiteten inte synkas. */
export function entityRepo(repos: Repositories, entity: string): EntityRepo | null {
  const key = SOURCE_KEY_BY_ENTITY[entity];
  if (!key) return null;
  // `key` är en source-key (= repo-fältnamn); den dynamiska dispatchen kräver
  // en keyof-assertion (sträng→nyckel), men VÄRDET förblir typat (EntityRepo).
  return repos[key as RepoKey] ?? null;
}

/**
 * En rad läst inom byrån: `null` om den inte finns, eller om den tillhör en
 * annan byrå (en annan byrås rad blir aldrig data i svaret).
 */
export async function getInOrg(repos: Repositories, entity: string, id: string, orgId: string): Promise<Row | null> {
  const repo = entityRepo(repos, entity);
  const row = repo ? await repo.getById(id) : null;
  if (!repo || !row) return null;
  return (await repo.organizationOf(row)) === orgId ? row : null;
}
