/**
 * `demoStaticParams` — generateStaticParams för demo-builden.
 *
 * Next 16 + `output: "export"` kräver att alla dynamic-route-params
 * enumereras vid build-tid; client-side navigation till okända params
 * fungerar inte (det är skillnaden mot full-server-builds). Därför
 * pre-renderar vi 1 HTML per seed-id PLUS en sentinel-shell.
 *
 * Sentinel-shellen (`/<route>/__shell__/`) används både för:
 *   - self-hosted (nginx try_files-fallback för nya entity-id:n)
 *   - GH Pages demo (404.html redirectar nya id:n hit + ?_p=<path>)
 *
 * Datan kommer in-process från `buildSeed()` — single source of truth
 * delad med seed-skrivnings-stegen.
 */

export const SHELL_PARAM = "__shell__";

const DEMO_ORG_ID = "demo-firma-ab";
const DEMO_CURRENT_USER_ID = "u-anna";
const DEMO_EMAIL_DOMAIN = "ava.demo";
const DEMO_ORG_NAME = "Demo Advokatbyrå AB";

export async function demoStaticParams(pathPrefix: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  const ids = await collectDemoIds(pathPrefix);
  return [...ids, SHELL_PARAM].map((id) => ({ id }));
}

export async function collectDemoIds(pathPrefix: string): Promise<string[]> {
  try {
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
