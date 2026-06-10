/**
 * `github-auth` — detektera auth-mode mot GitHub API.
 *
 * Tre lägen:
 *   1. **anonymous**       — ingen token, eller token ogiltig
 *   2. **identified-read**  — token funkar, men user kan inte pusha
 *   3. **identified-write** — token funkar och har push-rättigheter
 *
 * Använder `api.github.com` som har `Access-Control-Allow-Origin: *`,
 * så fungerar utan CORS-proxy.
 *
 * För self-hosted git-repos (Tier 3) kan vi inte detektera
 * permissions utan GitHub-API. Då litar vi på user:s explicita
 * token-närvaro: token → identified-write, annars anonymous.
 */

import { z } from "zod";
import { isLocalOrSameOrigin } from "@/lib/client/sync/cors-proxy";

export type AuthMode = "anonymous" | "identified-read" | "identified-write";

// Zod vid parsegränsen (#187): GitHub-API-svar (identitet + access-beslut)
// valideras — aldrig rena casts på nätverksdata.
const gitHubUserSchema = z.object({
  login: z.string().min(1),
  id: z.number().int(),
  name: z.string().nullish(),
  avatar_url: z.string().optional(),
});

const repoResponseSchema = z.object({
  permissions: z.object({ push: z.boolean().optional(), pull: z.boolean().optional() }).optional(),
}).passthrough();

export type GitHubUser = z.infer<typeof gitHubUserSchema>;

export interface RepoPermissions {
  canRead: boolean;
  canPush: boolean;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
}

/**
 * Parse repo-sträng till owner+repo. Stöder:
 *   - "user/repo"
 *   - "https://github.com/user/repo[.git]"
 *   - "git@github.com:user/repo[.git]"
 *
 * Returnerar null för self-hosted URL:er (inte GitHub).
 */
export function parseRepoUrl(input: string): ParsedRepo | null {
  if (!input) return null;
  const trimmed = input.trim();

  // https://github.com/user/repo[.git]
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };

  // git@github.com:user/repo[.git]
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! };

  // user/repo (kortform)
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (shortMatch && !trimmed.startsWith("http") && !trimmed.includes("@")) {
    return { owner: shortMatch[1]!, repo: shortMatch[2]! };
  }
  return null;
}

function authHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Hämta inloggad användare. Returnerar null om token saknas eller
 * är ogiltig.
 */
export async function getCurrentUser(token: string): Promise<GitHubUser | null> {
  if (!token) return null;
  try {
    const res = await fetch("https://api.github.com/user", { headers: authHeaders(token) });
    if (!res.ok) return null;
    const parsed = gitHubUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Hämta permissions för (owner, repo). Returnerar null om repo:t
 * inte är åtkomligt (privat utan token, eller hittas inte).
 */
export async function getRepoPermissions(
  token: string,
  owner: string,
  repo: string,
): Promise<RepoPermissions | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return null;
    const body = repoResponseSchema.safeParse(await res.json());
    const perms = body.success ? body.data.permissions : undefined;
    if (!perms) {
      // Publika repo: kan läsa men inte pusha
      return { canRead: true, canPush: false };
    }
    return { canRead: perms.pull ?? true, canPush: perms.push ?? false };
  } catch {
    return null;
  }
}

export interface DetectArgs {
  token: string;
  repoUrl: string;
}

/**
 * Detektera auth-mode genom att kombinera token-validation +
 * repo-permissions. För self-hosted (icke-GitHub) URL:er hanteras
 * det optimistiskt: token → write, ingen token → anonymous.
 */
// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'detectAuthMode' has a complexity of 11. Maximum allowed is 8.)
export async function detectAuthMode(args: DetectArgs): Promise<AuthMode> {
  const parsed = parseRepoUrl(args.repoUrl);

  // Self-hosted (icke-GitHub) — vi vet inte permissions via API:n.
  if (!parsed) {
    // Lokal/samma-origin git-server (docker:8080/git) tillåter anonym
    // push → write även utan token. Annars: token → write, annars anon.
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    if (isLocalOrSameOrigin(args.repoUrl, origin)) return "identified-write";
    return args.token ? "identified-write" : "anonymous";
  }

  if (!args.token) {
    // Anonymt + GitHub-repo: bekräfta att det är publikt (kan läsas).
    const perms = await getRepoPermissions("", parsed.owner, parsed.repo);
    return perms?.canRead ? "anonymous" : "anonymous";
  }

  // Med token: verifiera identitet + push-status.
  const user = await getCurrentUser(args.token);
  if (!user) return "anonymous"; // token funkar inte
  const perms = await getRepoPermissions(args.token, parsed.owner, parsed.repo);
  if (perms?.canPush) return "identified-write";
  return "identified-read";
}
