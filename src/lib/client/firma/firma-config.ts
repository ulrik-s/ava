/**
 * `FirmaConfig` — vilken repo + token AVA-appen ska peka mot.
 *
 * Två tier:s av deploy (ADR 0016, server-first):
 *   1. Demo (default) — publikt `ulrik-s/ava-demo` via GH Pages (read-only)
 *   2. Self-hosted — byråns server (Postgres + tRPC bakom oauth2-proxy/OIDC),
 *      nås same-origin; ingen git-URL eller token behövs
 *
 * (Den gamla `github`-tiern — eget privat git-repo via iso-git — pensionerades
 * i #500–#502. Lagrad `github` migreras till `demo` vid inläsning.)
 *
 * Persisteras i localStorage. Browser-only (SSR-safe via guard).
 */

import { z } from "zod";

import { loadFromStorage } from "@/lib/client/load-from-storage";
import { omitUndefined } from "@/lib/shared/omit-undefined";

export type FirmaTier = "demo" | "self-hosted";

export interface FirmaConfig {
  tier: FirmaTier;
  /**
   * Repo-identifierare:
   *   - tier=demo: "user/repo" (kortform mot GH Pages — demons datakälla)
   *   - tier=self-hosted: oanvänd (servern nås same-origin via tRPC)
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
 * Default-org matchar server-first-runtimens default `AVA_ORGANIZATION_ID`
 * (server-first docker-stacken, #410/#626) så klientens in-process-queries
 * (allowlist vid OIDC-login, data) scopar mot SAMMA org som servern seedar.
 * (Det gamla "firma-ab" var git-tierns repo-namn, #500–502-pensionerat, och
 * matchade aldrig en server-first-org — org-kolumnen är ett uuid.)
 * Författar-identiteten är generisk; användaren uppdaterar via `/settings`.
 */
const SELF_HOSTED_LOCALHOST_DEFAULT: FirmaConfig = {
  tier: "self-hosted",
  repo: "http://localhost:8080/git/firma.git",
  token: "",
  organizationId: "00000000-0000-0000-0000-000000000001",
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


// Zod vid parsegränsen (#187): lagrad config valideras innan spread in i
// domänobjektet. Alla fält optionella (partiella skrivningar förekommer);
// .passthrough() bevarar okända fält från nyare versioner i andra flikar.
const storedFirmaConfigSchema = z.object({
  // Migrera bort den pensionerade `github`-tiern → `demo` (#514).
  tier: z.preprocess((v) => (v === "github" ? "demo" : v), z.enum(["demo", "self-hosted"]).optional()),
  repo: z.string().optional(),
  token: z.string().optional(),
  organizationId: z.string().optional(),
  principalId: z.string().optional(),
  authorName: z.string().optional(),
  authorEmail: z.string().optional(),
  corsProxy: z.string().optional(),
}).passthrough();

export function loadFirmaConfig(): FirmaConfig {
  if (typeof window === "undefined") return DEMO_DEFAULT;
  const fallback = defaultConfigForHost(window.location.hostname);
  try {
    const parsed = loadFromStorage(STORAGE_KEY, storedFirmaConfigSchema, {});
    return {
      ...fallback,
      ...omitUndefined(parsed),
      // Tomt repo → fall tillbaka till hostens default
      repo: parsed.repo || fallback.repo,
    };
  } catch {
    return fallback;
  }
}

/**
 * RUNTIME demo-beslut för dokument-/länk-vägval (#651/#844). Använd detta — INTE
 * bygg-tids `NEXT_PUBLIC_DEMO_BUILD`, som är `1` även i den lokala self-hosted-
 * builden (out/ byggs av build:demo) och då felaktigt länkar dokument till GH
 * Pages → 404. Tiern avgörs av firma-config (hostname-default + /settings).
 */
export function isDemoTier(): boolean {
  return loadFirmaConfig().tier === "demo";
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
 * Demo-default som en fristående kopia. Används av reset-flows som måste
 * skriva tillbaka tier=demo EXPLICIT — `defaultConfigForHost` ger nämligen
 * self-hosted på localhost, så att bara radera `ava.firma` skulle kicka ut
 * en lokal användare ur demo-läget. Se `resetDemoCompletely`.
 */
export function demoConfig(): FirmaConfig {
  return { ...DEMO_DEFAULT };
}
