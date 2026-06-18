/**
 * Web git-clone ovanpå `FsaIsoGitAdapter`.
 *
 * Bygger på isomorphic-git för clone. Används av github-tier:ns
 * "Klona repo hit"-flöde i /settings (`FsaFolderSelector`).
 *
 * Sedan #420 (ADR 0016) finns ingen git-SYNK längre (status/commit/push/pull
 * via iso-git togs bort tillsammans med `pick-provider`); demon kör offline-
 * first-kärnan och self-hosted är server-first. Bara clone återstår.
 *
 * Designval (CORS-frihet): clone via isomorphic-git + GH Pages-läge (eller
 * corsProxy när det krävs för privata repos via OAuth-token).
 */

import type * as IsomorphicGit from "isomorphic-git";
import type { FsClient } from "isomorphic-git";
import type * as IsomorphicGitHttp from "isomorphic-git/http/web";
import { DEFAULT_CORS_PROXY } from "@/lib/client/sync/cors-proxy";
import type { FsaIsoGitAdapter } from "./fs-adapter";

/**
 * `FsaIsoGitAdapter` exponerar `promises`-API:t som isomorphic-git
 * förväntar sig (`PromiseFsClient`). Den här hjälpfunktionen ger en
 * typad vy så att vi slipper `fs as any` vid varje git-anrop.
 */
function asFsClient(fs: FsaIsoGitAdapter): FsClient {
  return fs;
}

export interface CloneOptions {
  url: string;
  ref?: string;
  /** OAuth-token eller PAT för privata repos. */
  token?: string;
  /**
   * Basic-auth-användarnamn. GitHub: "x-access-token" (default). Self-hosted
   * nginx auth_basic: den faktiska htpasswd-användaren (admin/email).
   */
  username?: string;
  /** CORS-proxy URL för smart-http (default = isomorphic-git:s publika). */
  corsProxy?: string;
}

/**
 * Normalisera cors-proxy-värdet:
 *   - "" (tom sträng) → undefined: medvetet INGEN proxy (lokal/samma-origin).
 *   - undefined → default publik proxy (bakåtkompat för befintliga anrop).
 *   - annars → det angivna värdet.
 */
function normalizeProxy(p: string | undefined): string | undefined {
  if (p === "") return undefined;
  return p ?? DEFAULT_CORS_PROXY;
}

async function loadIsoGit(): Promise<typeof IsomorphicGit> {
  return import("isomorphic-git");
}

async function loadHttp(): Promise<typeof IsomorphicGitHttp> {
  return import("isomorphic-git/http/web");
}

export async function cloneRepo(
  fs: FsaIsoGitAdapter,
  opts: CloneOptions,
): Promise<void> {
  const git = await loadIsoGit();
  const httpMod = await loadHttp();
  const http = httpMod.default ?? httpMod;
  const ref = opts.ref ?? "main";
  const corsProxy = normalizeProxy(opts.corsProxy);
  const onAuth = opts.token
    ? () => ({ username: opts.username || "x-access-token", password: opts.token! })
    : undefined;

  // Försök först en vanlig clone. Om mappen redan har en partiell git-init
  // (t.ex. från ett tidigare avbrutet försök) får vi "already exists" på
  // origin-remote:n. Då kör vi istället en idempotent reset:
  //   1. Sätt om remote.origin.url (force)
  //   2. fetch
  //   3. checkout ref med force (skriver över ev. half-applied files)
  try {
    await git.clone({
      fs: asFsClient(fs),
      http,
      dir: "/",
      url: opts.url,
      ref,
      singleBranch: true,
      depth: 1,
      corsProxy,
      onAuth,
    });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(msg)) throw err;
    // Fall through till re-init nedan
  }

  await git.setConfig({
    fs: asFsClient(fs),
    dir: "/",
    path: "remote.origin.url",
    value: opts.url,
  });
  await git.fetch({
    fs: asFsClient(fs),
    http,
    dir: "/",
    url: opts.url,
    ref,
    singleBranch: true,
    depth: 1,
    corsProxy,
    onAuth,
  });
  await git.checkout({
    fs: asFsClient(fs),
    dir: "/",
    ref,
    force: true,
  });
}
