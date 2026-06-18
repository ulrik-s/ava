/**
 * `loadDemoSeed` — direkt seed-loader för GH-Pages-demon (ADR 0016, #420).
 *
 * Ersätter den gamla kedjan `DemoRuntime → MemFs → ProjectionHydrator →
 * demoSourceFromRuntime`. Eftersom demon nu kör på den persisterade
 * `CachingSyncDataStore` (offline-first-kärnan) behövs ingen in-memory git-
 * working-tree (MemFs/slab) längre — vi fetchar bara filerna och bygger en
 * `DemoSource` DIREKT, som blir storens `seed` (populerar IndexedDB-cachen
 * vid första besök).
 *
 * Steg:
 *   1. Fetch `<baseUrl>/manifest.json` → `{ paths: string[] }`.
 *   2. Fetch varje path parallellt (retry/backoff mot Fastly-CDN-503:or).
 *   3. Versionsgrind (ADR 0004): vägra ett repo nyare än koden förstår.
 *   4. Gruppera varje fil per entitet via `pathToSourceKey` (samma path→entitet-
 *      mappning som projection-registret använde) och parsa JSON direkt.
 *   5. `prebakeJoins` (delad med server-runtimen) → färdig `DemoSource`.
 *
 * Designval (DI): `fetchFn` injiceras → tester använder en fake-fetch som
 * returnerar deterministisk data; produktion använder global `fetch`.
 */

import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";
import { schemaVersionFromMetaJson } from "@/lib/shared/meta-json";
import { assertRepoSchemaCompatible } from "@/lib/shared/schema-version";
import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import { pathToSourceKey } from "./demo-source-keys";

export interface DemoSeedLoaderOpts {
  /** Bas-URL till den GH Pages-publicerade demo-repo:n (auto-härleds annars). */
  baseUrl?: string;
  /** Inject:bar fetch — default global `fetch`. */
  fetchFn?: typeof fetch;
  /** Max parallella file-fetches. Default 12. */
  concurrency?: number;
  /** Max antal omförsök vid transienta fel (429/5xx/nätverk). Default 4. */
  maxRetries?: number;
  /** Inject:bar sleep mellan omförsök — default exponentiell backoff. */
  sleepFn?: (ms: number) => Promise<void>;
}

interface DemoManifest {
  paths: string[];
  generatedAt?: string;
  version?: number;
}

type RetryFetch = (url: string) => Promise<Response>;

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponentiell backoff med tak: 250ms, 500ms, 1s, 2s, … (max 4s). */
function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 4000);
}

/** Ett svar är definitivt om det inte är värt att försöka igen. */
function isDefinitive(res: Response): boolean {
  return res.ok || res.status === 404 || !TRANSIENT_STATUS.has(res.status);
}

/**
 * Bygg en `RetryFetch` som backar av exponentiellt vid transienta fel.
 * GitHub Pages serveras via Fastly-CDN som soft-rate-limitar burst:ar av
 * parallella requests med HTTP 503/429 även när filen finns. `cache: "no-store"`
 * kringgår browserns HTTP-cache så "Återställ demo" verkligen hämtar färsk data.
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
        const res = await fetchFn(url, { method: "GET", cache: "no-store" });
        if (isDefinitive(res)) return res;
        lastResponse = res;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError ?? new Error(`Kunde inte hämta ${url}`);
  };
}

async function fetchManifest(retryFetch: RetryFetch, baseUrl: string): Promise<DemoManifest> {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const res = await retryFetch(manifestUrl);
  if (!res.ok) {
    throw new Error(
      `Kunde inte hämta demo-manifest från ${manifestUrl}: HTTP ${res.status}. ` +
      `Är GH Pages aktiverat på demo-repo:t och har manifest.json genererats?`,
    );
  }
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== "object" || !("paths" in json)) {
    throw new Error(`Demo-manifest från ${manifestUrl} har fel format (förväntade { paths: string[] })`);
  }
  return json as DemoManifest;
}

/** En fetchad fil: dess repo-relativa path + textinnehåll. */
interface FetchedFile {
  path: string;
  body: string;
}

interface FetchAllArgs {
  retryFetch: RetryFetch;
  baseUrl: string;
  paths: string[];
  concurrency: number;
  maxRetries: number;
}

/** Fetcha alla paths parallellt. 404:s loggas men kastar inte (Jekyll strippar
 *  dot-folders). Alla 404 → kasta (GH Pages nere/ej deployad). */
async function fetchAll(args: FetchAllArgs): Promise<FetchedFile[]> {
  const { retryFetch, baseUrl, paths, concurrency, maxRetries } = args;
  const queue = [...paths];
  const files: FetchedFile[] = [];
  const missing: string[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const path = queue.shift();
      if (!path) return;
      const cleanPath = path.replace(/^\/+/, "");
      const fileUrl = `${baseUrl}/${cleanPath}`;
      const res = await retryFetch(fileUrl);
      if (!res.ok) {
        if (res.status === 404) { missing.push(cleanPath); continue; }
        throw new Error(
          `Kunde inte hämta ${fileUrl}: HTTP ${res.status} (efter ${maxRetries} omförsök). ` +
          `Tjänsten kan vara tillfälligt otillgänglig — försök igen om en stund.`,
        );
      }
      files.push({ path: cleanPath, body: await res.text() });
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) workers.push(worker());
  await Promise.all(workers);

  if (files.length === 0 && paths.length > 0) {
    throw new Error(
      `Kunde inte hämta NÅGON fil från ${baseUrl} — alla ${paths.length} paths 404:ade. ` +
      `Kontrollera att GH Pages är aktiverat på datakälla-repo:t och att manifest.json är up-to-date.`,
    );
  }
  logMissing(missing, baseUrl);
  return files;
}

function logMissing(missing: string[], baseUrl: string): void {
  if (missing.length === 0) return;
  const dotPathOnly = missing.every((p) => p.startsWith("."));
  const logFn = dotPathOnly ? console.info : console.warn;
  logFn(
    `[demo-seed-loader] ${missing.length} fil(er) saknades på ${baseUrl}: ` +
    `${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}` +
    (dotPathOnly ? " (Jekyll strippar dot-folders — lägg till en tom `.nojekyll` i repo-roten)" : ""),
  );
}

/** Läs repots schemaVersion ur `.ava/meta.json`-filen (saknad/trasig → v1). */
function repoSchemaVersion(files: FetchedFile[]): number {
  const meta = files.find((f) => f.path === DEMO_META_PATH);
  if (!meta) return 1;
  try {
    return schemaVersionFromMetaJson(meta.body) ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Gruppera de fetchade JSON-filerna per `DemoSource`-nyckel. En fil som inte
 * mappar mot någon känd entitet (t.ex. meta.json, dokument-innehåll) hoppas.
 * Korrupt JSON loggas men kastar inte — resten av seed:en laddas ändå.
 */
function assembleSource(files: FetchedFile[]): DemoSource {
  const grouped: Record<string, Record<string, unknown>[]> = {};
  for (const file of files) {
    if (!file.path.endsWith(".json")) continue;
    const key = pathToSourceKey(file.path);
    if (!key) continue;
    try {
      const row = JSON.parse(file.body) as Record<string, unknown>;
      (grouped[key] ??= []).push(row);
    } catch (err) {
      console.warn(`[demo-seed-loader] kunde inte parsa ${file.path}:`, err);
    }
  }
  return grouped as DemoSource;
}

interface ResolvedOpts {
  baseUrl: string;
  concurrency: number;
  maxRetries: number;
  retryFetch: RetryFetch;
}

/** Defaulta opts + bygg retry-fetch (bryts ut för att hålla `loadDemoSeed` ≤8). */
function resolveOpts(repo: string, opts: DemoSeedLoaderOpts): ResolvedOpts {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const maxRetries = opts.maxRetries ?? 4;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  return {
    baseUrl: opts.baseUrl ?? resolveGhPagesUrl(repo),
    concurrency: opts.concurrency ?? 12,
    maxRetries,
    retryFetch: makeRetryFetch(fetchFn, maxRetries, sleepFn),
  };
}

/**
 * Ladda demo-seed:en direkt till en `DemoSource`. `repo` kan vara en GH Pages-
 * URL, `github.com/<user>/<repo>` eller `<user>/<repo>` (auto-härleds).
 */
export async function loadDemoSeed(repo: string, opts: DemoSeedLoaderOpts = {}): Promise<DemoSource> {
  const { baseUrl, concurrency, maxRetries, retryFetch } = resolveOpts(repo, opts);

  const manifest = await fetchManifest(retryFetch, baseUrl);
  if (!Array.isArray(manifest.paths) || manifest.paths.length === 0) {
    throw new Error(`GH Pages-manifest från ${baseUrl}/manifest.json är tomt eller ogiltigt`);
  }

  const files = await fetchAll({ retryFetch, baseUrl, paths: manifest.paths, concurrency, maxRetries });

  // Versionsgrind (ADR 0004): vägra ett repo som är nyare än koden förstår.
  assertRepoSchemaCompatible(repoSchemaVersion(files));

  return prebakeJoins(assembleSource(files));
}
