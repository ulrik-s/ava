/**
 * `loadSelfHostedSource` — laddar data för self-hosted-tier:n (egen
 * git-server, t.ex. docker:8080/git/ eller en firma-Linux-låda).
 *
 * Flöde:
 *   1. Klona repo:t in i working copy:n (FSA- eller OPFS-handle) om det
 *      inte redan finns en .git/ där. Lokal/samma-origin → ingen cors-proxy.
 *   2. Hydrera `DemoSource` från de klonade JSON-filerna.
 *
 * Skrivningar (write-back) och löpande sync (pull/push) sköts av samma
 * FSA-pipeline som annars — denna funktion gör bara initial load.
 *
 * `clone`/`dirExists` injiceras för testbarhet (DI).
 */

import { FsaIsoGitAdapter } from "@/lib/client/fsa/fs-adapter";
import { cloneRepo, type CloneOptions } from "@/lib/client/fsa/git-ops";
import { resolveCorsProxy } from "@/lib/client/sync/cors-proxy";
import { hydrateWorkingCopy } from "./hydrate-working-copy";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  /** Roll i organisationen. Default ADMIN för self-hosted (firma-ägaren). */
  role?: string;
}

export interface LoadSelfHostedDeps {
  handle: FileSystemDirectoryHandle;
  repo: string;
  token?: string;
  /** window.location.origin — för same-origin-detektering (cors-proxy). */
  origin?: string;
  /**
   * Den inloggade användaren. Provisioneras som User-rad i git-db:n om den
   * saknas — krävs av flöden som slår upp ctx.user (t.ex. timeEntry.create
   * → users.findUniqueOrThrow för hourlyRate).
   */
  currentUser?: CurrentUser;
  /** Injicerbar clone (default: cloneRepo via isomorphic-git). */
  clone?: (fs: FsaIsoGitAdapter, opts: CloneOptions) => Promise<void>;
  /** Injicerbar "är redan klonad?"-check (default: finns /.git). */
  dirExists?: (fs: FsaIsoGitAdapter, path: string) => Promise<boolean>;
}

async function defaultDirExists(fs: FsaIsoGitAdapter, path: string): Promise<boolean> {
  try {
    await fs.readdir(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadSelfHostedSource(deps: LoadSelfHostedDeps): Promise<DemoSource> {
  const fs = new FsaIsoGitAdapter(deps.handle);
  const dirExists = deps.dirExists ?? defaultDirExists;

  if (!(await dirExists(fs, "/.git"))) {
    const corsProxy = resolveCorsProxy({ url: deps.repo, origin: deps.origin });
    await (deps.clone ?? cloneRepo)(fs, {
      url: deps.repo,
      token: deps.token,
      corsProxy,
      ref: "main",
    });
  }

  const source = await hydrateWorkingCopy(deps.handle);
  if (deps.currentUser) {
    await ensureCurrentOrganization(fs, source, deps.currentUser.organizationId);
    await ensureCurrentUser(fs, source, deps.currentUser);
  }
  return source;
}

/**
 * Säkerställ att en Organization-rad finns för current-user. `getSettings` /
 * `updateSettings` (samt andra org-scopade flöden) gör `findUniqueOrThrow` och
 * kraschar annars på en fräsch clone. Skriver `.ava/organizations/<id>.json`
 * via samma path som fsa-write-back; auto-sync pushar vid nästa ändring.
 */
async function ensureCurrentOrganization(
  fs: FsaIsoGitAdapter,
  source: DemoSource,
  organizationId: string,
): Promise<void> {
  const orgs = (source.organizations ?? []) as Array<{ id?: string }>;
  if (orgs.some((o) => o.id === organizationId)) return;
  const now = new Date();
  const row = {
    id: organizationId,
    name: "",
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(`/.ava/organizations/${organizationId}.json`, JSON.stringify(row, null, 2) + "\n");
  (source as Record<string, readonly unknown[]>).organizations = [...orgs, row];
}

/**
 * Säkerställ att den inloggade användaren finns som User-rad. Skriver
 * `.ava/users/<email>.json` (samma path som fsa-write-back) + lägger till i
 * source så att uppslag mot ctx.user funkar direkt. Auto-sync committar +
 * pushar filen vid nästa ändring.
 */
async function ensureCurrentUser(
  fs: FsaIsoGitAdapter,
  source: DemoSource,
  user: CurrentUser,
): Promise<void> {
  const users = (source.users ?? []) as Array<{ id?: string }>;
  if (users.some((u) => u.id === user.id)) return;
  const now = new Date();
  const row = {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    // Self-hosted-läget: den som först bootar appen är byrå-ägaren → ADMIN.
    // user.current läser tillbaka rollen ur dataStore (inte ctx.user); utan
    // role-fältet skulle UI:n visa "Endast admin kan ..." trots att ctx.user
    // är ADMIN.
    role: user.role ?? "ADMIN",
    active: true,
    // Rimlig default-timtaxa (öre/h) så registrerad tid har ett värde direkt;
    // byrån justerar via profil/användarinställningar.
    hourlyRate: 150_000,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(`/.ava/users/${user.email}.json`, JSON.stringify(row, null, 2) + "\n");
  (source as Record<string, readonly unknown[]>).users = [...users, row];
}
