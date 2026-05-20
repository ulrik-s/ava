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
   * Org-id som filtreras i data:n. Default "demo-firma-ab" (matchar
   * `ulrik-s/ava-demo`). Real firms sätter sin egen.
   */
  organizationId: string;
  /** Användarnamn för commits. */
  authorName: string;
  authorEmail: string;
}

const STORAGE_KEY = "ava.firma";

const DEMO_DEFAULT: FirmaConfig = {
  tier: "demo",
  repo: "ulrik-s/ava-demo",
  token: "",
  organizationId: "demo-firma-ab",
  authorName: "AVA Demo",
  authorEmail: "demo@ava.local",
};

export function loadFirmaConfig(): FirmaConfig {
  if (typeof window === "undefined") return DEMO_DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<FirmaConfig>;
    return {
      ...DEMO_DEFAULT,
      ...parsed,
      // Tomt repo → fall tillbaka till demo
      repo: parsed.repo || DEMO_DEFAULT.repo,
    };
  } catch {
    return DEMO_DEFAULT;
  }
}

export function saveFirmaConfig(cfg: FirmaConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
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
