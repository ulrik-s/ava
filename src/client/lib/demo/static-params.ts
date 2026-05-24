/**
 * `collectDemoIds` — hämtar demo-data-repo:ts manifest vid build-time
 * och extraherar id:n för en given prefix. Används av
 * `generateStaticParams()` på dynamiska routes i demo-builden.
 *
 * Manifest-format (från `scripts/generate-demo-manifest.ts`):
 *   { paths: ["matters/active/m-arvskifte.json", ...], ... }
 *
 * Default-repo: `ulrik-s/ava-demo` på GH Pages. Override via env
 * `NEXT_PUBLIC_DEFAULT_DEMO_REPO`.
 *
 * Kör i Node vid `next build`. Använder global fetch (Node ≥18).
 */

const DEFAULT_REPO = process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";

/**
 * Sentinel-param för dynamiska detaljrutter. Genererar en statisk shell
 * (`/<route>/__shell__/`) som nginx serverar för GODTYCKLIGA id:n i
 * self-hosted-läget — klienten läser riktiga id:t via `useRouteId()`.
 */
export const SHELL_PARAM = "__shell__";

/**
 * `generateStaticParams`-helper: demo-id:n (om demo-build) + alltid
 * sentinel-shell:en, så self-hosted-clonens nya poster kan öppnas.
 */
export async function demoStaticParams(pathPrefix: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  const ids = await collectDemoIds(pathPrefix);
  return [...ids, SHELL_PARAM].map((id) => ({ id }));
}

function ghPagesBase(repo: string): string {
  const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m) return `https://${m[1]}.github.io/${m[2]}`;
  return repo.replace(/\/+$/, "");
}

export async function collectDemoIds(pathPrefix: string): Promise<string[]> {
  const base = ghPagesBase(DEFAULT_REPO);
  try {
    const res = await fetch(`${base}/manifest.json`);
    if (!res.ok) return [];
    const manifest = await res.json() as { paths?: string[] };
    if (!Array.isArray(manifest.paths)) return [];
    const prefix = pathPrefix.replace(/\/+$/, "") + "/";
    return manifest.paths
      .filter((p) => p.startsWith(prefix) && p.endsWith(".json"))
      .map((p) => p.slice(prefix.length, -".json".length));
  } catch {
    return [];
  }
}
