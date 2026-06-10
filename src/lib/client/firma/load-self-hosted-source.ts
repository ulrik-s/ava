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
import { setDocumentContent } from "@/lib/client/demo/document-content-cache";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { assertRepoSchemaCompatible } from "@/lib/shared/schema-version";
import { schemaVersionFromMetaJson } from "@/lib/shared/meta-json";
import { DEMO_META_PATH } from "../../../../tooling/demo-config";
import { omitUndefined } from "@/lib/shared/omit-undefined";

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
  /** Basic-auth-användarnamn (self-hosted htpasswd; default x-access-token). */
  username?: string;
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
    const corsProxy = resolveCorsProxy({
      url: deps.repo,
      ...omitUndefined({ origin: deps.origin }),
    });
    await (deps.clone ?? cloneRepo)(fs, {
      url: deps.repo,
      ...omitUndefined({ token: deps.token, username: deps.username }),
      corsProxy,
      ref: "main",
    });
  }

  // Versionsgrind (ADR 0004): vägra ett repo som är nyare än koden förstår,
  // FÖRE hydrering. Saknad/ogiltig meta → baslinje (v1) → fortsätt.
  const repoVersion = (await readWorkingCopySchemaVersion(fs)) ?? 1;
  assertRepoSchemaCompatible(repoVersion);

  // Migrate-on-read: lyft äldre rader till aktuell datamodell vid hydrering.
  const source = await hydrateWorkingCopy(deps.handle, repoVersion);
  // Ladda extraherad dokumenttext (documents/text/<id>.txt) från OPFS in i
  // content-cache:n så fritext-sök hittar PDF/DOCX-innehåll EFTER en
  // sid-navigering (cache:n är in-memory + nollställs vid full page-load;
  // preloadDocumentContents fetchar via HTTP vilket inte når OPFS).
  await hydrateExtractedText(fs);
  if (deps.currentUser) {
    await ensureCurrentOrganization(fs, source, deps.currentUser.organizationId);
    await ensureCurrentUser(fs, source, deps.currentUser);
  }
  return source;
}

/**
 * Läs `schemaVersion` ur den klonade working copy:ns `.ava/meta.json`. Saknad
 * fil (repo seedat före grinden) eller trasig JSON → `undefined`, vilket
 * grinden tolkar som v1-baslinje. Kastar aldrig själv.
 */
async function readWorkingCopySchemaVersion(
  fs: FsaIsoGitAdapter,
): Promise<number | undefined> {
  try {
    // Zod vid parsegränsen (#187) — delad helper för alla meta.json-läsare.
    return schemaVersionFromMetaJson((await fs.readFile(`/${DEMO_META_PATH}`, "utf8")) as string);
  } catch {
    return undefined;
  }
}

/** Läs documents/text/<id>.txt ur OPFS → content-cache (för fritext-sök). */
async function hydrateExtractedText(fs: FsaIsoGitAdapter): Promise<void> {
  let files: string[];
  try { files = await fs.readdir("/documents/text"); }
  catch { return; } // ingen extraherad text än
  await Promise.all(
    files.filter((f) => f.endsWith(".txt")).map(async (f) => {
      try {
        const text = (await fs.readFile(`/documents/text/${f}`, "utf8")) as string;
        if (text) setDocumentContent(f.replace(/\.txt$/, ""), text);
      } catch { /* hoppa över trasig/oläsbar fil */ }
    }),
  );
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
