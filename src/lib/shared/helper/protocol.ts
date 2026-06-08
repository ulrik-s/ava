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
