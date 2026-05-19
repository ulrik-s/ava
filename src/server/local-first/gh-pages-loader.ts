/**
 * `createGhPagesCloneFn` — DemoCloneFn-impl som fetchar filer från en
 * **GitHub Pages-publicerad** demo-repo istället för att klona via
 * git-protokollet.
 *
 * Varför: GitHub Pages serverar publika filer med
 * `Access-Control-Allow-Origin: *` direkt — ingen CORS-proxy behövs.
 * `api.github.com` har också CORS men 60 req/h utan auth gör det
 * obrukbart för demos med många filer. GH Pages har ingen meningsfull
 * rate-limit för demo-volym.
 *
 * Designval (Single responsibility):
 *   - Bara fetch+skriv. Inget hydratiseringsansvar — det sköter
 *     `DemoLoader` via `ProjectionHydrator`.
 *
 * Designval (Dependency inversion):
 *   - `fetchFn` injiceras → tester använder fake-fetch som returnerar
 *     deterministisk data. Produktion använder global `fetch`.
 *
 * Designval (Open-closed):
 *   - `manifest.json`-formatet är `{ paths: string[] }`. Lägg till fält
 *     vid behov (version, checksums) utan att bryta bakåt-kompat —
 *     loadern ignorerar okända fält.
 *
 * Manifest-protokoll:
 *   - Klienten fetchar `<baseUrl>/manifest.json`
 *   - Svaret innehåller `{ paths: string[] }` — relativa sökvägar i
 *     repo-roten som ska laddas (typiskt JSON-filer)
 *   - Varje path fetchas parallellt → skrivs till MemFs
 *
 * Manifestet genereras av `scripts/generate-demo-manifest.ts` i
 * demo-repo:t och commitas. Trigga via en GitHub Action vid push.
 */

import type { MemFs } from "./mem-fs";
import type { DemoCloneFn } from "./demo-loader";

export interface GhPagesLoaderOpts {
  /**
   * Bas-URL till den GH Pages-publicerade demo-repo:n.
   * T.ex. `https://ulrik-s.github.io/ava-demo`. Trailing-slash hanteras.
   */
  baseUrl?: string;
  /** Inject:bar fetch — default global `fetch`. */
  fetchFn?: typeof fetch;
  /** Max parallella file-fetches. Default 12 — bra balans mellan
      latency och soft-rate-limit på CDN-edge. */
  concurrency?: number;
}

export interface DemoManifest {
  /** Repo-relativa sökvägar (utan ledande slash). */
  paths: string[];
  /** Fritt format-fält — ignoreras av loadern, för diagnostik. */
  generatedAt?: string;
  version?: number;
}

/**
 * Skapa en `DemoCloneFn` som fetchar via GH Pages. URL:en som skickas
 * till `loadDemo(url)` kan vara:
 *
 *   - `https://ulrik-s.github.io/ava-demo` (direkt GH Pages-URL)
 *   - `https://github.com/ulrik-s/ava-demo` (auto-mappas till GH Pages)
 *   - `ulrik-s/ava-demo` (förkortning)
 *
 * I de två senare fallen härleds GH Pages-URL automatiskt.
 */
export function createGhPagesCloneFn(opts: GhPagesLoaderOpts = {}): DemoCloneFn {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const concurrency = opts.concurrency ?? 12;

  return async function ghPagesClone(fs: MemFs, url: string): Promise<void> {
    const baseUrl = opts.baseUrl ?? resolveGhPagesUrl(url);

    const manifest = await fetchManifest(fetchFn, baseUrl);
    if (!Array.isArray(manifest.paths) || manifest.paths.length === 0) {
      throw new Error(`GH Pages-manifest från ${baseUrl}/manifest.json är tomt eller ogiltigt`);
    }

    await fetchAndWriteAll(fetchFn, baseUrl, manifest.paths, fs, concurrency);
  };
}

/**
 * Översätt en användar-angiven URL till GH Pages-URL. Heuristik:
 *   - `github.com/<user>/<repo>` → `<user>.github.io/<repo>`
 *   - `<user>/<repo>`           → `<user>.github.io/<repo>`
 *   - allt annat returneras som-är (antas vara redan korrekt)
 */
export function resolveGhPagesUrl(input: string): string {
  const trimmed = input.replace(/\/+$/, "");

  // github.com/<user>/<repo> eller https://github.com/<user>/<repo>
  const gh = trimmed.match(/^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (gh) return `https://${gh[1]}.github.io/${gh[2]}`;

  // user/repo (kort form)
  const short = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) return `https://${short[1]}.github.io/${short[2]}`;

  return trimmed;
}

async function fetchManifest(
  fetchFn: typeof fetch,
  baseUrl: string,
): Promise<DemoManifest> {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const res = await fetchFn(manifestUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `Kunde inte hämta demo-manifest från ${manifestUrl}: HTTP ${res.status}. ` +
      `Är GH Pages aktiverat på demo-repo:t och har manifest.json genererats?`,
    );
  }
  const json = await res.json() as unknown;
  if (!json || typeof json !== "object" || !("paths" in json)) {
    throw new Error(`Demo-manifest från ${manifestUrl} har fel format (förväntade { paths: string[] })`);
  }
  return json as DemoManifest;
}

async function fetchAndWriteAll(
  fetchFn: typeof fetch,
  baseUrl: string,
  paths: string[],
  fs: MemFs,
  concurrency: number,
): Promise<void> {
  // Enkel parallell-kö: konsumera från arrayen N samtidigt
  const queue = [...paths];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  async function worker(): Promise<void> {
    for (;;) {
      const path = queue.shift();
      if (!path) return;
      const cleanPath = path.replace(/^\/+/, "");
      const fileUrl = `${baseUrl}/${cleanPath}`;
      const res = await fetchFn(fileUrl, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Kunde inte hämta ${fileUrl}: HTTP ${res.status}`);
      }
      const body = await res.text();
      await fs.writeFile(cleanPath, body);
    }
  }
}
