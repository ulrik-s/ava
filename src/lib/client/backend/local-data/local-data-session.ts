/**
 * Öppna de lokala databaserna för den som loggar in (#1347) — self-hosted.
 *
 * Körs i bootstrappen efter sessionsgrinden, innan någon databas öppnas:
 *
 *   1. Raderingar som blockerades förra gången görs om.
 *   2. Ägaren av de gemensamma databaserna från före #1347 avgörs (en gång).
 *   3. Ny eller annan identitet (`binding`): den förra användarens session i
 *      webbläsaren är slut — hennes lokala data rensas som vid en utloggning
 *      (hennes osynkade arbete ligger kvar i hennes egna databaser). Inget
 *      binds: bindningsfasen kör en store i minnet, och sidan laddas om när
 *      principalen är bunden.
 *   4. Annars binds användarens egen namnrymd. Äger hon de gemensamma
 *      databaserna flyttas de in; annars tas deras cache-kopior bort.
 */

import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { adoptLegacyDatabases } from "./adopt-legacy";
import { legacyOwner, ownsLegacyData, type LegacyOwner } from "./legacy-owner";
import type { LocalDataPlace } from "./local-data-locations";
import { bindLocalNamespace, localScopeSchema, userNamespace, type LocalScope } from "./local-namespace";
import { purgeLegacyCaches, purgeLocalData, resumePendingPurge, type PurgeEnv } from "./purge-local-data";

/** Principalen när ingen är bunden och driften saknar OIDC (samma som in-process-routerns). */
const UNBOUND_PRINCIPAL = "current-user";

/** Configens fält som avgör vems data det är. */
export type IdentityConfig = Pick<FirmaConfig, "organizationId" | "principalId" | "authorEmail">;

/** Den bundna användaren enligt configen, eller null om ingen är bunden. */
export function boundScope(cfg: IdentityConfig): LocalScope | null {
  if (!cfg.principalId) return null;
  const parsed = localScopeSchema.safeParse({ organizationId: cfg.organizationId, principalId: cfg.principalId });
  return parsed.success ? parsed.data : null;
}

/** Den som arbetar nu: den bundna — eller, utan OIDC, den obundna principalen. */
export function workingScope(cfg: IdentityConfig): LocalScope {
  return boundScope(cfg) ?? localScopeSchema.parse({ organizationId: cfg.organizationId, principalId: UNBOUND_PRINCIPAL });
}

/** Den förra användarens session i webbläsaren är slut: rensa som vid en utloggning. */
export async function retireScope(env: PurgeEnv, scope: LocalScope, owner: LegacyOwner, email: string): Promise<void> {
  const adoptsLegacy = ownsLegacyData(owner, scope, email);
  if (adoptsLegacy) await adoptLegacyDatabases(env.factory, scope);
  await purgeLocalData(env, { factory: env.factory, ns: userNamespace(scope), adoptsLegacy });
}

/**
 * Förbered de lokala databaserna. `null` = bindningsfasen (inget får sparas
 * lokalt förrän det är avgjort vem som loggar in); annars platsen för den
 * inloggades databaser, med hennes namnrymd bunden.
 */
export async function openLocalDataSession(
  env: PurgeEnv, cfg: IdentityConfig, args: { binding: boolean },
): Promise<LocalDataPlace | null> {
  await resumePendingPurge(env);
  const owner = legacyOwner(cfg, env.storage);
  const previous = boundScope(cfg);
  if (args.binding) {
    if (previous) await retireScope(env, previous, owner, cfg.authorEmail);
    return null;
  }
  const scope = workingScope(cfg);
  const adoptsLegacy = ownsLegacyData(owner, scope, cfg.authorEmail);
  if (adoptsLegacy) await adoptLegacyDatabases(env.factory, scope);
  else await purgeLegacyCaches(env);
  const ns = userNamespace(scope);
  bindLocalNamespace(ns);
  return { factory: env.factory, ns, adoptsLegacy };
}
