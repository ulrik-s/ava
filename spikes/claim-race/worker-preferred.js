#!/usr/bin/env node
/**
 * Variant: preferred-runner. JSONL-per-dag som format.
 *
 * För varje claim, beräknas en "primary" baserat på hash(claimId) mod numUsers.
 * Primary försöker direkt. Andra väntar 1.5–2.0 sek (skalat ner från 15s
 * för spike-syfte) och kollar om primary klarade det. Om inte: nästa
 * preferred försöker.
 *
 * I produktion: delay = 15-20s. Här: 1500-2000ms för att hinna med spike.
 */

import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
const ALL_USERS = args.users.split(",");
const MAX_RETRIES = Number(args["max-retries"] ?? 50);
const BASE_DELAY_MS = 1500;

function git(cmd) {
  return execSync(`git -C "${WORKDIR}" ${cmd}`, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
function gitNoFail(cmd) { try { return git(cmd); } catch { return null; } }

function hash(s) { return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16); }

function preferredOrder(claimId) {
  return [...ALL_USERS].sort((a, b) => hash(claimId + a) - hash(claimId + b));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const todayPath = "claims/today.jsonl";
const todayFull = join(WORKDIR, todayPath);

function appendClaim(claimId) {
  if (!existsSync(join(WORKDIR, "claims"))) mkdirSync(join(WORKDIR, "claims"), { recursive: true });
  appendFileSync(todayFull, JSON.stringify({
    claimId, claimedBy: USER, at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  }) + "\n");
}

function existingClaim(claimId) {
  if (!existsSync(todayFull)) return null;
  const lines = readFileSync(todayFull, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l)).find((c) => c.claimId === claimId);
}

async function tryClaim(claimId) {
  const startedAt = Date.now();
  const order = preferredOrder(claimId);
  const myRank = order.indexOf(USER);
  await sleep(myRank * BASE_DELAY_MS);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    gitNoFail("fetch origin main");
    gitNoFail("reset --hard origin/main");
    const existing = existingClaim(claimId);
    if (existing && existing.claimedBy !== USER) {
      return { won: false, by: existing.claimedBy, attempts: attempt + 1, ms: Date.now() - startedAt };
    }
    appendClaim(claimId);
    git("add claims/today.jsonl");
    git(`-c user.email=${USER}@spike -c user.name=${USER} commit -m "claim: ${claimId}"`);
    try {
      execSync(`git -C "${WORKDIR}" push origin main`, { stdio: ["ignore", "pipe", "pipe"] });
      return { won: true, attempts: attempt + 1, ms: Date.now() - startedAt };
    } catch {
      // retry
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
