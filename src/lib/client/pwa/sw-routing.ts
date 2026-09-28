/**
 * `sw-routing` (#1240) — rena funktioner som avgör hur service workern ska
 * hantera en förfrågan. Inga sidoeffekter; `sw-handlers` gör själva cache-
 * och nätarbetet.
 *
 * Reglerna är en ALLOWLIST över app-skalet. Allt som inte uttryckligen är skal
 * (tRPC, git, inloggning, hälsokontroller, demo-data, dokument-bytes) går
 * orört till nätet: en cachad dataförfrågan kan annars servera gammal eller
 * främmande data, och en cachad inloggning kan låsa ut användaren.
 *
 * Alla sökvägar här är APP-RELATIVA — basen (`/ava` på GH Pages, tom i prod)
 * är redan borttagen, så samma regler gäller oavsett var appen ligger.
 */

/** Hur en förfrågan hanteras. */
export type SwStrategy =
  /** Innehållshashat och oföränderligt: cache först, nätet vid miss. */
  | "cache-first"
  /** Sidor och RSC-payloads: nätet först (färsk version), cache när nätet är nere. */
  | "network-first"
  /** Inte app-skal: service workern svarar inte alls. */
  | "bypass";

/** Det av en `Request` som routingen behöver. */
export interface SwRequestInfo {
  url: string;
  method: string;
  mode: string;
}

/** Var service workern lever: origin + bas-sökväg (utan avslutande snedstreck). */
export interface SwScope {
  origin: string;
  basePath: string;
}

/**
 * Rutter vars detaljsidor skapas i körande app och därför saknar förrenderad
 * HTML. Servern (Caddy/nginx) skriver om dem till `__shell__`-sidan; offline
 * gör service workern samma sak. Måste matcha `shell`-regexen i Caddyfile.
 */
const SHELL_ROUTES: ReadonlySet<string> = new Set(["matters", "contacts", "invoices", "payment-plans", "users", "templates"]);

const SHELL_PARAM = "__shell__";

/** `https://host/ava/` → `/ava`; `https://host/` → `""`. */
export function scopeBasePath(scopeUrl: string): string {
  return new URL(scopeUrl).pathname.replace(/\/+$/, "");
}

/** App-relativ sökväg, eller `null` om URL:en ligger utanför scope. */
export function appRelativePath(url: URL, scope: SwScope): string | null {
  if (url.origin !== scope.origin) return null;
  const { pathname } = url;
  if (scope.basePath === "") return pathname;
  if (pathname === scope.basePath) return "/";
  return pathname.startsWith(`${scope.basePath}/`) ? pathname.slice(scope.basePath.length) : null;
}

/** Sökvägar som aldrig är app-skal, även när de öppnas som navigering. */
const NEVER_SHELL = /^\/(?:api|git|oauth2)(?:\/|$)|^\/(?:healthz|readyz)$/;

/** RSC-payloads från den statiska exporten (`index.txt`, `__next.<segment>.txt`). */
function isRscPayload(relPath: string): boolean {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return name === "index.txt" || (name.startsWith("__next.") && name.endsWith(".txt"));
}

function strategyForPath(relPath: string, mode: string): SwStrategy {
  if (NEVER_SHELL.test(relPath)) return "bypass";
  if (relPath.startsWith("/_next/static/") || relPath === "/favicon.ico") return "cache-first";
  if (mode === "navigate" || isRscPayload(relPath)) return "network-first";
  return "bypass";
}

/** Strategi för en förfrågan. Ogiltiga URL:er och allt utanför scope → `bypass`. */
export function routeRequest(req: SwRequestInfo, scope: SwScope): SwStrategy {
  if (req.method !== "GET") return "bypass";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "bypass";
  }
  const rel = appRelativePath(url, scope);
  return rel === null ? "bypass" : strategyForPath(rel, req.mode);
}

/**
 * Den förcachade sida som ska svara på en navigering offline när sidan själv
 * inte finns i cachen: `__shell__`-sidan för runtime-id:n (URL:en behålls, så
 * `useRouteId` läser id:t ur sökvägen), annars roten — samma som serverns
 * `try_files … /index.html`.
 */
export function offlineFallbackPath(relPath: string): string {
  const segs = relPath.split("/").filter(Boolean);
  const [route] = segs;
  if (segs.length < 2 || route === undefined || !SHELL_ROUTES.has(route)) return "/";
  const tail = segs[2] === "edit" ? "edit/" : "";
  return `/${route}/${SHELL_PARAM}/${tail}`;
}

/** URL utan query och hash — cache-nyckeln för sidor (`?_rsc=` varierar per navigering). */
export function withoutSearch(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}
