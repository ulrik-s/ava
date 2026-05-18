#!/usr/bin/env node
/**
 * Worker som simulerar en AVA-klient som försöker claima rader i en
 * delad JSONL-fil via git push-CAS.
 *
 * Args:
 *   --workdir <dir>     egen worker-clone
 *   --user <id>         worker-identitet
 *   --shared-event <id> alla workers tävlar om samma claim (för test 1)
 *   --solo-count <N>    antal unika claims att försöka (för test 2)
 *   --max-retries <N>   max retry vid non-fast-forward
 */

import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
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

const todayPath = "claims/today.jsonl";
const todayFull = join(WORKDIR, todayPath);

function git(cmd) {
  return execSync(`git -C "${WORKDIR}" ${cmd}`, { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}
function gitNoFail(cmd) {
  try { return git(cmd); } catch (e) { return null; }
}

function appendClaim(claimId) {
  if (!existsSync(join(WORKDIR, "claims"))) mkdirSync(join(WORKDIR, "claims"), { recursive: true });
  const line = JSON.stringify({
    claimId,
    claimedBy: USER,
    at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  appendFileSync(todayFull, line + "\n");
}

function existingClaim(claimId) {
  if (!existsSync(todayFull)) return null;
  const lines = readFileSync(todayFull, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l)).find((c) => c.claimId === claimId);
}

async function tryClaim(claimId) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // 1. Fetch + reset till origin/main
    gitNoFail("fetch origin main");
    gitNoFail("reset --hard origin/main");
    // 2. Är claim redan tagen?
    const existing = existingClaim(claimId);
    if (existing && existing.claimedBy !== USER) {
      return { won: false, by: existing.claimedBy, attempts: attempt + 1, ms: Date.now() - startedAt };
    }
    // 3. Lägg till vår rad
    appendClaim(claimId);
    git("add claims/today.jsonl");
    git(`-c user.email=${USER}@spike -c user.name=${USER} commit -m "claim: ${claimId} by ${USER}"`);
    // 4. Försök pusha
    try {
      execSync(`git -C "${WORKDIR}" push origin main`, { stdio: ["ignore", "pipe", "pipe"] });
      return { won: true, attempts: attempt + 1, ms: Date.now() - startedAt };
    } catch {
      // non-fast-forward — retry
    }
  }
  return { won: false, attempts: MAX_RETRIES, ms: Date.now() - startedAt, exhausted: true };
}

const results = [];

if (SHARED) {
  results.push({ type: "shared", claimId: SHARED, ...(await tryClaim(SHARED)) });
}

for (let i = 0; i < SOLO; i++) {
  const claimId = `solo-${USER}-${i}`;
  results.push({ type: "solo", claimId, ...(await tryClaim(claimId)) });
}

process.stdout.write(JSON.stringify({ user: USER, results }) + "\n");
