#!/usr/bin/env bun
/**
 * `bootstrap-admin` (#224) — seeda första admin i OIDC-allowlisten på en färsk
 * self-hosted-stack. Körs på hosten (rotförtroende = shell-access), före första
 * OIDC-login. Skriver en admin-rad (`.ava/users/<email>.json`, role=ADMIN) i
 * firma.git-working-copy:n; efter commit/push kan personen logga in via OIDC och
 * resolvas som ADMIN ([[oidc-principal]]).
 *
 *   bun tooling/scripts/bootstrap-admin.ts --work-dir /srv/ava/wc \
 *     --email admin@byra.se --org <org-uuid> [--name "Anna"] [--commit]
 *
 * Idempotent: kör om → samma deterministiska id, skriver bara om raden saknas
 * eller inte redan är ADMIN. Logik i `bootstrap-admin/core.ts`; denna fil är
 * argv + fs + (valfri) git-commit.
 */

import { join } from "node:path";
import {
  buildAdminUserRow,
  adminUserGitPath,
  buildOrgRow,
  orgGitPath,
  metaJsonContent,
} from "./bootstrap-admin/core";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function log(msg: string): void {
  console.log(`[bootstrap-admin] ${msg}`);
}

/** Är raden redan en admin? (idempotens — undvik onödig skrivning/commit.) */
async function alreadyAdmin(path: string): Promise<boolean> {
  const { readFile } = await import("node:fs/promises");
  try {
    const row = JSON.parse(await readFile(path, "utf8")) as { role?: string };
    return row.role === "ADMIN";
  } catch {
    return false;
  }
}

async function gitCommit(workDir: string, email: string): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const run = (args: string[]) => spawnSync("git", ["-C", workDir, ...args], { stdio: "inherit" });
  run(["add", "-A"]);
  run(["commit", "-m", `feat(auth): bootstrap admin ${email} i firma.git (#224)`]);
  log("committat — pusha med `git push` (eller låt server-runtime-peern göra det).");
}

async function exists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  return access(path).then(() => true).catch(() => false);
}

/** Seeda org-roten + meta.json om de saknas (färsk firma.git). Returnerar true om något skrevs. */
async function seedOrgAndMeta(workDir: string, orgId: string, orgName: string): Promise<boolean> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(workDir, ".ava", "organizations"), { recursive: true });
  let wrote = false;

  const orgPath = join(workDir, orgGitPath(orgId));
  if (!(await exists(orgPath))) {
    await writeFile(orgPath, JSON.stringify(buildOrgRow({ id: orgId, name: orgName }), null, 2) + "\n");
    log(`org-rad skriven: ${orgGitPath(orgId)} (${orgName})`);
    wrote = true;
  }
  const metaPath = join(workDir, ".ava", "meta.json");
  if (!(await exists(metaPath))) {
    await writeFile(metaPath, metaJsonContent());
    log("meta.json skriven (.ava/meta.json)");
    wrote = true;
  }
  return wrote;
}

/** Seeda admin-allowlist-raden om den saknas. Returnerar true om den skrevs. */
async function seedAdmin(workDir: string, email: string, org: string, name: string | undefined): Promise<boolean> {
  const fullPath = join(workDir, adminUserGitPath(email));
  if (await alreadyAdmin(fullPath)) {
    log(`${email} är redan ADMIN — admin-raden lämnas orörd.`);
    return false;
  }
  const { mkdir, writeFile } = await import("node:fs/promises");
  const row = buildAdminUserRow({ email, organizationId: org, ...(name ? { name } : {}) });
  await mkdir(join(workDir, ".ava", "users"), { recursive: true });
  await writeFile(fullPath, JSON.stringify(row, null, 2) + "\n");
  log(`admin-rad skriven: ${adminUserGitPath(email)} (role=ADMIN, id=${row.id})`);
  return true;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const workDir = flag(argv, "work-dir");
  const email = flag(argv, "email");
  const org = flag(argv, "org");
  if (!workDir || !email || !org) {
    console.error("[bootstrap-admin] FEL: --work-dir, --email och --org krävs.");
    process.exitCode = 1;
    return;
  }

  // Färsk firma.git: seeda org + meta så appen inte kraschar (--org-name).
  const orgName = flag(argv, "org-name");
  const seededOrg = orgName ? await seedOrgAndMeta(workDir, org, orgName) : false;
  const seededAdmin = await seedAdmin(workDir, email, org, flag(argv, "name"));

  if (!seededOrg && !seededAdmin) {
    log("inget att göra — firma.git redan bootstrappad.");
    return;
  }
  if (argv.includes("--commit")) await gitCommit(workDir, email);
  else log("kör om med --commit för att committa, eller commita/pusha själv.");
}

main().catch((err: unknown) => {
  process.stderr.write(`[bootstrap-admin] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
