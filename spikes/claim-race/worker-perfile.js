#!/usr/bin/env node
/**
 * Variant: claim-per-fil istället för shared JSONL.
 * Olika claims = olika filer = ingen onödig push-kontention.
 *
 * Filsystem-layout:
 *   .ava/claims/<claimId>.json   (en fil per claim)
 *
 * Vid race på samma claim: båda försöker create file + push.
 * Bara en lyckas (git CAS), andra ser den vid retry-fetch och skippar.
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const WORKDIR = args.workdir;
const USER = args.user;
const SHARED = args["shared-event"];
const SOLO = Number(args["solo-count"] ?? 0);
const MAX_RETRIES = Number(args["max-retries"] ?? 50);

function git(cmd) {
  return execSync(`git -C "${WORKDIR}" ${cmd}`, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
function gitNoFail(cmd) { try { return git(cmd); } catch { return null; } }

async function tryClaim(claimId) {
  const startedAt = Date.now();
  const relPath = `claims/${claimId}.json`;
  const fullPath = join(WORKDIR, relPath);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    gitNoFail("fetch origin main");
    gitNoFail("reset --hard origin/main");

    if (existsSync(fullPath)) {
      const existing = JSON.parse(readFileSync(fullPath, "utf8"));
      if (existing.claimedBy !== USER) {
        return { won: false, by: existing.claimedBy, attempts: attempt + 1, ms: Date.now() - startedAt };
      }
    }

    if (!existsSync(join(WORKDIR, "claims"))) mkdirSync(join(WORKDIR, "claims"), { recursive: true });
    writeFileSync(fullPath, JSON.stringify({
      claimId, claimedBy: USER, at: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }));
    git(`add ${relPath}`);
    git(`-c user.email=${USER}@spike -c user.name=${USER} commit -m "claim: ${claimId}"`);

    try {
      execSync(`git -C "${WORKDIR}" push origin main`, { stdio: ["ignore", "pipe", "pipe"] });
      return { won: true, attempts: attempt + 1, ms: Date.now() - startedAt };
    } catch {
      // non-fast-forward, retry
    }
  }
  return { won: false, attempts: MAX_RETRIES, ms: Date.now() - startedAt, exhausted: true };
}

const results = [];
if (SHARED) results.push({ type: "shared", claimId: SHARED, ...(await tryClaim(SHARED)) });
for (let i = 0; i < SOLO; i++) {
  results.push({ type: "solo", claimId: `solo-${USER}-${i}`, ...(await tryClaim(`solo-${USER}-${i}`)) });
}
process.stdout.write(JSON.stringify({ user: USER, results }) + "\n");
