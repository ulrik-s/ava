/**
 * AVA Helper-protokoll — det delade kontraktet mellan webbappen
 * (`src/lib/client/helper/use-helper.ts`) och själva helper-binären
 * (`helper-app/`). En enda källa till sanning för portar, request-/
 * response-former och rena hjälpare så de två sidorna aldrig glider isär.
 *
 * Framework-agnostiskt (bara typer + rena funktioner) → bor i `shared`
 * och får importeras av både UI-lagret och den fristående Bun-binären.
 *
 * Bakgrund: ADR 0005 §Språk — all icke-frontend-kod i TS med samma
 * kod-/arkitektur-regler, så helpern kan dela typer rakt av (#78).
 */

/** Porten helpern lyssnar på (127.0.0.1). Aldrig extern. */
export const HELPER_PORT = 48761;

/** Bas-URL webbappen pratar mot. */
export const HELPER_BASE = `http://127.0.0.1:${HELPER_PORT}`;

/**
 * HTTPS-port (ADR 0006): Safari/WKWebView (Office-add-ins på Mac) blockerar
 * https-sida → http-loopback som mixed content och kräver HTTPS. Använder
 * `localhost` (matchar leaf-certets SAN/CN), inte 127.0.0.1.
 */
export const HELPER_HTTPS_PORT = 48762;

/** HTTPS-bas-URL (betrott lokalt cert via helperns CA). */
export const HELPER_HTTPS_BASE = `https://localhost:${HELPER_HTTPS_PORT}`;

/** Prefix i `GET /ping`-svaret: "ava-helper <version>". */
export const HELPER_PING_PREFIX = "ava-helper";

/**
 * `POST /open` — be helpern ladda ner en fil, öppna den i OS:ets
 * default-app och (om `uploadUrl` satt) synka tillbaka ändringar.
 */
export interface HelperOpenRequest {
  /** Varifrån fil-bytsen laddas ner. */
  downloadUrl: string;
  /** Vart ändrade bytes PUT:as efter save. Utelämnad → read-only. */
  uploadUrl?: string;
  /** Namnet användaren ser i editorn. */
  fileName: string;
  /** Vidarebefordras orörd till download + upload. */
  authHeader?: string;
  /** Hur länge helpern lyssnar på save-events. Default 60 min. */
  maxWatchMinutes?: number;
}

/** Svar på `POST /open`. */
export interface HelperOpenResponse {
  path: string;
  status: string;
}

/**
 * `POST /compose-mail` — be helpern öppna OS:ets mail-app med en
 * förifylld kompositions-vy + bifogad fil.
 */
export interface ComposeMailRequest {
  fileName: string;
  /** base64-kodade bytes. */
  contentBase64: string;
  /** MIME-typ för bilagan. */
  mimeType?: string;
  to?: string;
  subject: string;
  body: string;
}

/** Svar på `POST /compose-mail`. */
export interface ComposeMailResponse {
  path: string;
  status: string;
}

/** Svar på `GET /version`. */
export interface HelperVersionResponse {
  current: string;
  updateAvailable: boolean;
}

/**
 * `POST /content` — be helpern leverera dokument-bytes ur sitt durabla,
 * content-adresserade lager (ADR 0028 §3/§5). Cache-hit servas direkt (även
 * offline); miss laddas ner + cachas. Web-appen delegerar dokument-läsningar
 * hit när helpern finns → en enda lokal dokument-auktoritet, ingen divergens
 * mot extern-editor-öppningar.
 */
export interface HelperContentRequest {
  /** Varifrån bytsen laddas (identifierar dokument+version) — även cache-nyckel. */
  downloadUrl: string;
  /** Vidarebefordras orörd till nedladdning vid cache-miss. */
  authHeader?: string;
  /** Användarsynligt filnamn (för helperns logg/cache-metadata). */
  fileName?: string;
}

/**
 * En köad (ännu ej synkad) dokument-upload i helperns durabla kö (ADR 0028 §3).
 * Exponeras via `GET /status` så webbappen kan visa synk-status. Innehåller
 * ALDRIG authHeader (känsligt) — bara det UI:t behöver.
 */
export interface HelperSyncEntry {
  /** Stabilt id i kö-katalogen. */
  id: string;
  /** PUT-mål på servern (identifierar dokumentet). */
  uploadUrl: string;
  /** Användarsynligt filnamn. */
  fileName: string;
  /** När den först köades (ms sedan epoch). */
  enqueuedAt: number;
  /** Antal misslyckade upload-försök hittills. */
  attempts: number;
  /** Tidigast nästa försök (ms) — backoff. */
  nextAttemptAt: number;
  /** `pending` = väntar/retr:as; `conflict` = server gått förbi, kräver beslut. */
  status: "pending" | "conflict";
  /** Senaste felet (om något). */
  lastError?: string;
}

/**
 * Svar på `GET /status` — ögonblicksbild av helperns upload-kö (ADR 0028 §8).
 * Webbappen pollar detta för att visa "väntar på synk / konflikt"-status så
 * offline-sparningar aldrig är osynliga (motsatsen till KATS-HIIT).
 */
export interface HelperStatusResponse {
  /** Antal poster som väntar/retr:as. */
  pending: number;
  /** Antal poster i versions-konflikt (kräver beslut). */
  conflict: number;
  /** Totalt antal poster i kön. */
  total: number;
  /** Posterna (utan authHeaders). */
  entries: HelperSyncEntry[];
}

/**
 * Webbappens vy av helper-status: undefined = ej kontrollerat,
 * null = inte tillgänglig, string = installerad version.
 */
export interface HelperStatus {
  version: string | undefined | null;
  checked: boolean;
}

/** Bygg `GET /ping`-svaret. Helpern producerar, webbappen parsar. */
export function formatPing(version: string): string {
  return `${HELPER_PING_PREFIX} ${version}\n`;
}

/**
 * Plocka versionen ur ett `/ping`-svar ("ava-helper v1.2.3" → "v1.2.3").
 * Returnerar null om strängen inte matchar förväntat format.
 */
export function parsePingVersion(text: string): string | null {
  const m = text.trim().match(/^ava-helper\s+(\S+)/);
  return m?.[1] ?? null;
}

/**
 * Filnamns-sanity: stoppar path-traversal ut ur helperns tempkatalog.
 * Avvisar tom sträng, ".", ".." och namn som innehåller `/`, `\` eller NUL.
 * Delad så webbappen kan validera innan den skickar (defense in depth).
 */
export function isSafeFileName(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false;
  return !/[/\\\0]/.test(name);
}

/**
 * CORS-whitelist: localhost-portar (dev/self-hosted), *.github.io
 * (GH-Pages-demon) och valfria extra origins.
 *
 * `extraOrigins` matas av helpern från `AVA_HELPER_ORIGINS` (komma-
 * separerad). Ren funktion → testbar utan env.
 */
export function isAllowedOrigin(origin: string, extraOrigins: readonly string[] = []): boolean {
  if (origin === "") return false;
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    return true;
  }
  if (origin.endsWith(".github.io")) return true;
  return extraOrigins.some((extra) => extra.trim() !== "" && extra.trim() === origin);
}
