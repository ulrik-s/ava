/**
 * `FirmaConfig` — vilken repo + token AVA-appen ska peka mot.
 *
 * Tre tier:s av deploy:
 *   1. Demo (default) — publikt `ulrik-s/ava-demo` via GH Pages
 *   2. GitHub private — user-vald repo + PAT
 *   3. Self-hosted — user-vald HTTPS git-URL (Cleura/Linux) + token
 *
 * Persisteras i localStorage. Browser-only (SSR-safe via guard).
 */

export type FirmaTier = "demo" | "github" | "self-hosted";

export interface FirmaConfig {
  tier: FirmaTier;
  /**
   * Repo-identifierare:
   *   - tier=demo: "user/repo" (kortform mot GH Pages)
   *   - tier=github: "user/repo" eller "https://github.com/user/repo.git"
   *   - tier=self-hosted: full HTTPS-URL (t.ex. "https://git.firma.se/data.git")
   */
  repo: string;
  /** GitHub PAT eller motsvarande auth-token. Tomt för publik demo. */
  token: string;
  /**
   * Org-id som filtreras i data:n. Tom sträng på första start → demo-bootstrap
   * hämtar värdet från `.ava/meta.json` (demo) eller failar tydligt
   * (self-hosted). INGA hårdkodade demo-strängar längre.
   */
  organizationId: string;
  /**
   * Vald inloggad användares id. Tom → demo-bootstrap redirectar till
   * `/login` så användaren kan välja konto. Sätts av login-flowet.
   */
  principalId?: string;
  /** Användarnamn för commits. */
  authorName: string;
  authorEmail: string;
  /**
   * Git-auth-användarnamn (Basic-auth mot self-hosted nginx auth_basic).
   * nginx htpasswd-användaren är "admin" (bootstrap) eller en e-post
   * (add-user.sh). GitHub använder "x-access-token". Tomt → härleds:
   * self-hosted faller till `authorEmail`, annars "x-access-token".
   * Se `gitAuthUsername()`.
   */
  gitUsername?: string;
  /**
   * URL till CORS-proxy för git smart-HTTP-trafiken. GitHub:s git-
   * endpoints saknar CORS-headers så vi måste gå via en proxy.
   * Tomt → använd default (cors.isomorphic-git.org, instabil).
   * Egen Cloudflare Worker rekommenderas för produktion.
   */
  corsProxy?: string;
}

const STORAGE_KEY = "ava.firma";

/**
 * Repo-pekare för demo:n.
 *   - `NEXT_PUBLIC_DEMO_REPO` bakas in vid build (CI sätter det) och pekar
 *     då på samma-origin data (där build-demo.sh seedade direkt i `out/`).
 *   - Saknas variabeln → fall tillbaka på publika referensdemon
 *     `ulrik-s/ava-demo` för utvecklare som bygger lokalt utan att seeda.
 */
const DEMO_REPO = process.env.NEXT_PUBLIC_DEMO_REPO || "ulrik-s/ava-demo";

const DEMO_DEFAULT: FirmaConfig = {
  tier: "demo",
  repo: DEMO_REPO,
  token: "",
  // Tomt: web-appen läser värdet från `.ava/meta.json` vid bootstrap.
  organizationId: "",
  authorName: "AVA Demo",
  authorEmail: "demo@ava.local",
};

/**
 * Default när vi körs lokalt mot docker (`tooling/docker/docker-compose.yml`).
 * Same-origin när användaren öppnar `http://localhost:8080/ava/` (statisk
 * export), eller cross-origin när dev-servern körs på `:3000` — `pickProvider`
 * + same-origin-detektor hanterar bägge.
 *
 * Default-org "firma-ab" matchar git-repo:t som docker startar (firma.git i
 * `tooling/docker/git-ssh`). Författar-identiteten är generisk; användaren
 * uppdaterar via `/settings`.
 */
const SELF_HOSTED_LOCALHOST_DEFAULT: FirmaConfig = {
  tier: "self-hosted",
  repo: "http://localhost:8080/git/firma.git",
  token: "",
  organizationId: "firma-ab",
  authorName: "Lokal användare",
  authorEmail: "user@firma.local",
};

/**
 * Vilken default-config ska vi använda för en given hostname?
 *
 * - `localhost` / `127.0.0.1` → self-hosted mot docker (`localhost:8080`).
 *   Det här gör att `next dev` och den statiska exporten beter sig som
 *   en självhostad firma-Linux-låda utan att användaren behöver konfigurera
 *   något — docker måste vara igång, men det är förutsättningen för
 *   "git lokalt".
 * - Övrigt (gh-pages-domän etc.) → publik demo.
 *
 * Pure-helper — testas direkt utan att mocka `window`.
 */
export function defaultConfigForHost(hostname: string | undefined): FirmaConfig {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    return SELF_HOSTED_LOCALHOST_DEFAULT;
  }
  return DEMO_DEFAULT;
}

export function loadFirmaConfig(): FirmaConfig {
  if (typeof window === "undefined") return DEMO_DEFAULT;
  const fallback = defaultConfigForHost(window.location.hostname);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FirmaConfig>;
    return {
      ...fallback,
      ...parsed,
      // Tomt repo → fall tillbaka till hostens default
      repo: parsed.repo || fallback.repo,
    };
  } catch {
    return fallback;
  }
}

export function saveFirmaConfig(cfg: FirmaConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/**
 * Patch:a en delmängd av config:en — t.ex. när login-flowet sätter
 * `principalId` + `organizationId` efter att meta.json laddats.
 */
export function patchFirmaConfig(patch: Partial<FirmaConfig>): FirmaConfig {
  const next = { ...loadFirmaConfig(), ...patch };
  saveFirmaConfig(next);
  return next;
}

export function resetToDemo(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Heuristik för tier baserat på repo-strängen. Används om user
 * inte explicit valt tier.
 */
export function inferTier(repo: string): FirmaTier {
  if (repo.includes("github.com") || /^[^/]+\/[^/]+$/.test(repo)) {
    return "github";
  }
  if (repo.startsWith("https://") || repo.startsWith("http://")) {
    return "self-hosted";
  }
  return "demo";
}

/**
 * Git-auth-användarnamn för Basic-auth.
 *
 * - **self-hosted** (nginx auth_basic + htpasswd): den faktiska htpasswd-
 *   användaren — explicit `gitUsername`, annars `authorEmail` (add-user.sh
 *   lägger till på e-post). "x-access-token" som sista fallback.
 * - **github/demo**: GitHub:s konvention "x-access-token".
 *
 * Varför detta behövs: nginx auth_basic validerar användarnamnet mot
 * htpasswd. "x-access-token" finns inte där → 401. (Bug-fix.)
 */
export function gitAuthUsername(cfg: Pick<FirmaConfig, "tier" | "gitUsername" | "authorEmail">): string {
  if (cfg.tier === "self-hosted") {
    return cfg.gitUsername || cfg.authorEmail || "x-access-token";
  }
  return "x-access-token";
}
