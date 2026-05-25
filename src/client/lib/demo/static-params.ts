/**
 * `collectDemoIds` — bygger samma seed-data som deploy-stegen skriver till
 * out/ och extraherar id:n för en given prefix. Används av
 * `generateStaticParams()` på dynamiska routes i demo-builden.
 *
 * Tidigare hämtades id:na via fetch från ett separat data-repo, men nu
 * när demo + data lever i SAMMA repo är det ett chicken-and-egg-problem
 * (manifest skapas EFTER `next build`). Lösning: läs in-process från
 * `buildSeed()` direkt — single source of truth, ingen nätverksdep.
 *
 * Kör i Node vid `next build`.
 */

/**
 * Sentinel-param för dynamiska detaljrutter. Genererar en statisk shell
 * (`/<route>/__shell__/`) som nginx serverar för GODTYCKLIGA id:n i
 * self-hosted-läget — klienten läser riktiga id:t via `useRouteId()`.
 */
export const SHELL_PARAM = "__shell__";

const DEMO_ORG_ID = "demo-firma-ab";
const DEMO_CURRENT_USER_ID = "u-anna";
const DEMO_EMAIL_DOMAIN = "ava.demo";
const DEMO_ORG_NAME = "Demo Advokatbyrå AB";

/**
 * `generateStaticParams`-helper: demo-id:n (om demo-build) + alltid
 * sentinel-shell:en, så self-hosted-clonens nya poster kan öppnas.
 */
export async function demoStaticParams(pathPrefix: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  const ids = await collectDemoIds(pathPrefix);
  return [...ids, SHELL_PARAM].map((id) => ({ id }));
}

export async function collectDemoIds(pathPrefix: string): Promise<string[]> {
  try {
    // Dynamisk import för att undvika att seed-deps drar in i klient-bundle.
    // Tsx-loadern matar denna funktion vid `next build` i Node-kontekst.
    const { buildSeed, seedToFiles } = await import("../../../../tooling/scripts/seed-data");
    const seed = buildSeed({
      orgId: DEMO_ORG_ID,
      currentUserId: DEMO_CURRENT_USER_ID,
      emailDomain: DEMO_EMAIL_DOMAIN,
      organizationName: DEMO_ORG_NAME,
    });
    const files = seedToFiles(seed);
    const prefix = pathPrefix.replace(/\/+$/, "") + "/";
    return files
      .map((f) => f.path)
      .filter((p: string) => p.startsWith(prefix) && p.endsWith(".json"))
      .map((p: string) => p.slice(prefix.length, -".json".length));
  } catch {
    return [];
  }
}
