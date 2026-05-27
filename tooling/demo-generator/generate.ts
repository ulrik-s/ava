/**
 * `demo-generator` — fristående program som populerar den AKTIVA backenden
 * med demo-data via tRPC-API:t (ADR 0001/0003).
 *
 *   tsx tooling/demo-generator/generate.ts --backend=git --out=./demo-repo
 *   tsx tooling/demo-generator/generate.ts --backend=postgres   (stub)
 *
 * Git-läget producerar ett pushbart repo. Postgres-läget är en stub tills
 * PostgresStore finns (ADR 0001 Fas 3).
 *
 * STATUS: populate täcker första slice:n (organization → users → contacts).
 * Kvarstående entiteter (matters + matter-contacts, time/expenses, templates,
 * documents, calendar, tasks, conflicts) och BILLING via flöden (createAcconto
 * → recordPayment → createFinal, ADR-beslut 1a) byggs som nästa increment i
 * `populate.ts`.
 */

import { rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSeed } from "../scripts/seed-data";
import { makeNodeGitWriteBack } from "./node-git-writeback";
import { createGitTarget, createPostgresTarget, type BackendTarget } from "./backend-target";
import { populate } from "./populate";
import type { Principal } from "@/lib/server/auth/principal";

interface Args { backend: "git" | "postgres"; outDir: string; }

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const backend = (get("backend") ?? "git") as Args["backend"];
  if (backend !== "git" && backend !== "postgres") {
    throw new Error(`Okänd --backend=${backend} (git|postgres)`);
  }
  return { backend, outDir: get("out") ?? "./demo-repo" };
}

function gitCommit(outDir: string): void {
  const git = (...a: string[]) => execFileSync("git", a, { cwd: outDir, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=generator@ava.local", "-c", "user.name=Demo Generator", "add", "-A");
  git("-c", "user.email=generator@ava.local", "-c", "user.name=Demo Generator",
    "commit", "-q", "--allow-empty", "-m", "Demo-data (generated via tRPC)");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = buildSeed();
  const orgId = String(seed.organizations?.[0]?.id ?? "firma-ab");
  const principal: Principal = {
    id: "generator", email: "generator@ava.local", name: "Demo Generator",
    role: "ADMIN", organizationId: orgId,
  };

  let target: BackendTarget;
  if (args.backend === "postgres") {
    target = createPostgresTarget(); // kastar (stub) tills ADR 0001 Fas 3
  } else {
    rmSync(args.outDir, { recursive: true, force: true });
    mkdirSync(args.outDir, { recursive: true });
    target = createGitTarget({
      principal,
      writeBack: makeNodeGitWriteBack(args.outDir),
      onFinalize: async () => gitCommit(args.outDir),
    });
  }

  const res = await populate(target.caller, seed);
  await target.finalize();
  console.log(`[demo-generator] backend=${args.backend} →`, res);
  if (args.backend === "git") console.log(`[demo-generator] git-repo: ${args.outDir}`);
}

main().catch((err) => {
  console.error("[demo-generator] FEL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
