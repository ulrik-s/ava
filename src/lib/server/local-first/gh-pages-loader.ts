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
  /**
   * Max antal *omförsök* (utöver första försöket) vid transienta fel —
   * HTTP 429/500/502/503/504 eller nätverks-undantag. Default 4.
   *
   * Varför: GitHub Pages serveras via Fastly-CDN som soft-rate-limitar
   * burst:ar av parallella requests med HTTP 503/429 även när filen
   * finns. Utan omförsök fick en enda transient 503 hela demo-laddningen
   * att kasta. Vi backar av exponentiellt och försöker igen.
   */
  maxRetries?: number;
  /**
   * Inject:bar sleep mellan omförsök — default exponentiell backoff via
   * `setTimeout`. Tester injicerar en no-op för att slippa väntan.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

/** En fetch-funktion som redan har omförsöks-logik inbyggd. */
type RetryFetch = (url: string) => Promise<Response>;

/** HTTP-statusar som är transienta och värda att försöka igen. */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/** Default-sleep: löser efter `ms` millisekunder. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponentiell backoff med tak: 250ms, 500ms, 1s, 2s, … (max 4s). */
function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 4000);
}

/**
 * Ett svar är "definitivt" om det inte är värt att försöka igen: lyckat,
 * saknat (404), eller ett icke-transient fel.
 */
function isDefinitive(res: Response): boolean {
  return res.ok || res.status === 404 || !TRANSIENT_STATUS.has(res.status);
}

/**
 * Bygg en `RetryFetch` som backar av exponentiellt vid transienta fel
 * (HTTP 429/500/502/503/504 eller nätverks-undantag) och försöker igen
 * upp till `maxRetries` gånger. Returnerar `Response` så fort svaret är
 * definitivt; vid uttömda omförsök returneras sista transienta `Response`
 * (så anroparen kan kasta med rätt status) eller kastas sista undantaget.
 *
 * Varför closure: kapslar `fetchFn`/`maxRetries`/`sleepFn` så att anropare
 * bara behöver skicka URL:en (färre parametrar att tråda runt).
 */
function makeRetryFetch(
  fetchFn: typeof fetch,
  maxRetries: number,
  sleepFn: (ms: number) => Promise<void>,
): RetryFetch {
  return async function retryFetch(url: string): Promise<Response> {
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleepFn(backoffMs(attempt));
      try {
        // `cache: "no-store"` — kringgå browserns HTTP-cache helt. GitHub
        // Pages serveras via Fastly med `Cache-Control: max-age` så en
        // vanlig fetch returnerar cachade (gamla) bytes. Då visar "Återställ
        // demo" (som rensar OPFS/localStorage men inte HTTP-cachen) fortfa-
        // rande gammal seed-data, och en ny demo-deploy syns inte förrän
        // cachen TTL:ar ut. Den här fetch-vägen körs bara vid kall-laddning/
        // efter-reset (varma reloads återställer från OPFS) → ingen
        // prestanda-kostnad på hot-path.
        const res = await fetchFn(url, { method: "GET", cache: "no-store" });
        if (isDefinitive(res)) return res;
        lastResponse = res; // transient — försök igen
      } catch (err) {
        lastError = err; // nätverksfel — försök igen
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError ?? new Error(`Kunde inte hämta ${url}`);
  };
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
  const maxRetries = opts.maxRetries ?? 4;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const retryFetch = makeRetryFetch(fetchFn, maxRetries, sleepFn);

  return async function ghPagesClone(fs: MemFs, url: string): Promise<void> {
    const baseUrl = opts.baseUrl ?? resolveGhPagesUrl(url);

    const manifest = await fetchManifest(retryFetch, baseUrl);
    if (!Array.isArray(manifest.paths) || manifest.paths.length === 0) {
      throw new Error(`GH Pages-manifest från ${baseUrl}/manifest.json är tomt eller ogiltigt`);
    }

    await fetchAndWriteAll({ retryFetch, baseUrl, paths: manifest.paths, fs, concurrency, maxRetries });
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
  retryFetch: RetryFetch,
  baseUrl: string,
): Promise<DemoManifest> {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const res = await retryFetch(manifestUrl);
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

interface FetchAndWriteAllArgs {
  retryFetch: RetryFetch;
  baseUrl: string;
  paths: string[];
  fs: MemFs;
  concurrency: number;
  /** Antal omförsök — endast för felmeddelande-text. */
  maxRetries: number;
}

async function fetchAndWriteAll(args: FetchAndWriteAllArgs): Promise<void> {
  const { retryFetch, baseUrl, paths, fs, concurrency, maxRetries } = args;
  // Enkel parallell-kö: konsumera från arrayen N samtidigt.
  // Individuella 404:s loggas men kastar inte — det är vanligt att
  // GitHub Pages strippar `.dotfolders` (Jekyll-default) eller att
  // manifest:n är stale. Vi vill att resten av data:n laddas ändå.
  const queue = [...paths];
  const missing: string[] = [];
  let succeeded = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (succeeded === 0 && paths.length > 0) {
    throw new Error(
      `Kunde inte hämta NÅGON fil från ${baseUrl} — alla ${paths.length} paths 404:ade. ` +
      `Kontrollera att GH Pages är aktiverat på datakälla-repo:t och att manifest.json är up-to-date.`,
    );
  }
  if (missing.length > 0) {
    const dotPathOnly = missing.every((p) => p.startsWith("."));
    // Dot-folder-fall är förväntat (Jekyll-default) — degradera till
    // info istället för warn för att inte spamma consolen. Användaren
    // kan lägga till .nojekyll i repo-roten för att fixa.
    const logFn = dotPathOnly ? console.info : console.warn;
    logFn(
      `[gh-pages-loader] ${missing.length} fil(er) saknades på ${baseUrl}: ` +
      `${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}` +
      (dotPathOnly ? " (Jekyll strippar dot-folders som default — lägg till en tom `.nojekyll` i repo-roten för att fixa)" : ""),
    );
  }

  async function worker(): Promise<void> {
    for (;;) {
      const path = queue.shift();
      if (!path) return;
      const cleanPath = path.replace(/^\/+/, "");
      const fileUrl = `${baseUrl}/${cleanPath}`;
      const res = await retryFetch(fileUrl);
      if (!res.ok) {
        if (res.status === 404) {
          missing.push(cleanPath);
          continue;
        }
        // Andra fel (500/503/network) är allvarligare och har redan
        // försökts om `maxRetries` gånger med backoff — kasta så att
        // användaren reagerar (GH Pages nere eller ej deployad).
        throw new Error(
          `Kunde inte hämta ${fileUrl}: HTTP ${res.status} (efter ${maxRetries} omförsök). ` +
          `Tjänsten kan vara tillfälligt otillgänglig — försök igen om en stund.`,
        );
      }
      const body = await res.text();
      await fs.writeFile(cleanPath, body);
      succeeded++;
    }
  }
}
