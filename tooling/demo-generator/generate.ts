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
 * STATUS: populate täcker org → users → contacts → matters → matter-contacts
 * → time/expenses → calendar → tasks → templates → conflict-checks, och
 * populateBilling driver fakturerings-flödena (ADR-beslut 1a). Kvarstår:
 * dokument (metadata via API + binärinnehåll), se task-TODO.
 */

import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildSeed } from "../scripts/seed-data";
import { makeNodeGitWriteBack } from "./node-git-writeback";
import { createGitTarget, createPostgresTarget, type BackendTarget } from "./backend-target";
import { populate } from "./populate";
import { populateBilling } from "./populate-billing";
import { populateDocuments, type BinarySink } from "./populate-documents";
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
  const billing = await populateBilling(target.caller, seed); // efter time/expenses
  // Git: skriv binärinnehåll till documents/content/…; annars metadata-only.
  const sink: BinarySink | undefined = args.backend === "git"
    ? (storagePath, bytes) => {
        const full = join(args.outDir, storagePath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, bytes);
        return bytes.byteLength;
      }
    : undefined;
  const documents = await populateDocuments(target.caller, seed, sink);
  await target.finalize();
  console.log(`[demo-generator] backend=${args.backend} →`, { ...res, documents, billing });
  if (args.backend === "git") console.log(`[demo-generator] git-repo: ${args.outDir}`);
}

main().catch((err) => {
  console.error("[demo-generator] FEL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
