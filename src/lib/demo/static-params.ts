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
