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
import { buildAdminUserRow, adminUserGitPath } from "./bootstrap-admin/core";

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

async function gitCommit(workDir: string, relPath: string, email: string): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const run = (args: string[]) => spawnSync("git", ["-C", workDir, ...args], { stdio: "inherit" });
  run(["add", relPath]);
  run(["commit", "-m", `feat(auth): bootstrap admin ${email} i allowlisten (#224)`]);
  log("committat — pusha med `git push` (eller låt server-runtime-peern göra det).");
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

  const relPath = adminUserGitPath(email);
  const fullPath = join(workDir, relPath);
  if (await alreadyAdmin(fullPath)) {
    log(`${email} är redan ADMIN i allowlisten — inget att göra.`);
    return;
  }

  const nameFlag = flag(argv, "name");
  const row = buildAdminUserRow({ email, organizationId: org, ...(nameFlag ? { name: nameFlag } : {}) });
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(workDir, ".ava", "users"), { recursive: true });
  await writeFile(fullPath, JSON.stringify(row, null, 2) + "\n");
  log(`admin-rad skriven: ${relPath} (role=ADMIN, id=${row.id})`);

  if (argv.includes("--commit")) await gitCommit(workDir, relPath, email);
  else log("kör om med --commit för att committa, eller commita/pusha själv.");
}

main().catch((err: unknown) => {
  process.stderr.write(`[bootstrap-admin] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
