/**
 * `loadBundledSeed` (#544, ADR 0025) — hämtar demons seed som EN bundlad
 * `demo-seed.json` (emit:ad av `build-demo`) i st.f. `manifest.json` + N
 * parallella fil-fetchar (`loadDemoSeed`).
 *
 * Seeden matas sedan in i cachen via den riktiga `reconcile → pull`-vägen
 * (`StaticSyncSource`), inte via `seed`-optionen — så demon övar samma
 * hydrerings-väg som den riktiga klienten. En enda same-origin-fil → ingen
 * manifest-rundtripp, ingen burst av CDN-requests.
 *
 * Filen är redan en färdig `DemoSource` (prebake:ad vid bygget), så loadern är
 * en ren fetch+parse. `cache: "no-store"` så "Återställ demo" får färsk data.
 */

import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";

export const DEMO_SEED_FILE = "demo-seed.json";

export interface BundledSeedLoaderOpts {
  /** Bas-URL till den publicerade demo-datan (auto-härleds från repo annars). */
  baseUrl?: string;
  /** Inject:bar fetch — default global `fetch`. */
  fetchFn?: typeof fetch;
}

/** Ladda den bundlade `demo-seed.json` → `DemoSource`. */
export async function loadBundledSeed(repo: string, opts: BundledSeedLoaderOpts = {}): Promise<DemoSource> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl ?? resolveGhPagesUrl(repo);
  const url = `${baseUrl}/${DEMO_SEED_FILE}`;
  const res = await fetchFn(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Kunde inte hämta demo-seed från ${url}: HTTP ${res.status}. ` +
      `Är GH Pages aktiverat och har build-demo emit:at demo-seed.json?`,
    );
  }
  const source = (await res.json()) as DemoSource;
  // prebakeJoins är idempotent — säkerställer joins även om filen skulle vara
  // en rå (icke-prebake:ad) DemoSource.
  return prebakeJoins(source);
}
