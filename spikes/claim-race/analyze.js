#!/usr/bin/env node
/**
 * Analyserar spike-resultaten och skriver ut en rapport.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const [ROOT, NUM_WORKERS, SOLO_PER_WORKER, TOTAL_MS] = process.argv.slice(2);
const n = Number(NUM_WORKERS);
const solo = Number(SOLO_PER_WORKER);

// Läs worker-resultaten
const allResults = [];
for (let i = 1; i <= n; i++) {
  const f = join(ROOT, `result-${i}.json`);
  if (!existsSync(f) || readFileSync(f, "utf8").trim() === "") {
    console.error(`MISSING: result-${i}.json`);
    continue;
  }
  allResults.push(JSON.parse(readFileSync(f, "utf8")));
}

// Slå ihop alla claims
const allClaims = allResults.flatMap((r) => r.results.map((c) => ({ user: r.user, ...c })));

// ── Korrekthetstest 1: SHARED-claim ─────────────────────────────────
const shared = allClaims.filter((c) => c.type === "shared");
const sharedWinners = shared.filter((c) => c.won);
const sharedLosers = shared.filter((c) => !c.won);

// ── Korrekthetstest 2: SOLO-claims ──────────────────────────────────
const soloClaims = allClaims.filter((c) => c.type === "solo");
const soloWins = soloClaims.filter((c) => c.won);
const soloLosses = soloClaims.filter((c) => !c.won);

// ── JSONL-integritet ─────────────────────────────────────────────────
// Klona origin igen och inspektera den faktiska filen.
execSync(`git clone --quiet ${ROOT}/origin.git ${ROOT}/verify`, { stdio: "ignore" });
const finalFile = readFileSync(`${ROOT}/verify/claims/today.jsonl`, "utf8");
const lines = finalFile.split("\n").filter(Boolean);
const parsedLines = [];
const corruptLines = [];
for (const line of lines) {
  try { parsedLines.push(JSON.parse(line)); } catch { corruptLines.push(line); }
}
const sharedInFile = parsedLines.filter((c) => c.claimId === "evt-shared-001");
const soloInFile = parsedLines.filter((c) => c.claimId.startsWith("solo-"));

// ── Prestanda ────────────────────────────────────────────────────────
const wonAttempts = allClaims.filter((c) => c.won).map((c) => c.attempts);
const wonMs = allClaims.filter((c) => c.won).map((c) => c.ms);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const max = (xs) => (xs.length ? Math.max(...xs) : 0);
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * p)];
};

// ── Rapport ──────────────────────────────────────────────────────────
const report = `
================================================================
SPIKE: claim-race över git push-CAS
================================================================
Konfiguration:
  Workers:                     ${n}
  Unika claims per worker:     ${solo}
  Delade claims:               1 (alla ${n} tävlar)
  Total tid (wall clock):      ${TOTAL_MS} ms

────────────────────────────────────────────────────────────────
Korrekthetstest 1: en SHARED-claim, ${n} konkurrenter
────────────────────────────────────────────────────────────────
  Vinnare (worker.won === true):     ${sharedWinners.length}
  Förlorare (worker.won === false):  ${sharedLosers.length}
  Förväntat: vinnare === 1, förlorare === ${n - 1}
  Status: ${sharedWinners.length === 1 && sharedLosers.length === n - 1 ? "✅ PASS" : "❌ FAIL"}

  Vinnaren: ${sharedWinners[0]?.user ?? "(ingen)"}
  Genomsnitt försök för förlorare innan de gav upp:
    avg=${avg(sharedLosers.map((c) => c.attempts)).toFixed(1)}, max=${max(sharedLosers.map((c) => c.attempts))}

────────────────────────────────────────────────────────────────
Korrekthetstest 2: ${n} × ${solo} unika SOLO-claims
────────────────────────────────────────────────────────────────
  Försök:                            ${soloClaims.length}
  Lyckade:                           ${soloWins.length}
  Misslyckade:                       ${soloLosses.length}
  Förväntat: alla ${n * solo} lyckas (de tävlar inte mot varandra)
  Status: ${soloWins.length === n * solo ? "✅ PASS" : "❌ FAIL"}

────────────────────────────────────────────────────────────────
Datasäkerhet: faktiska JSONL-filen i remote
────────────────────────────────────────────────────────────────
  Rader totalt:                      ${lines.length}
  Parseable JSON:                    ${parsedLines.length}
  Korrupta rader:                    ${corruptLines.length}
  SHARED-rader i filen:              ${sharedInFile.length}
  SOLO-rader i filen:                ${soloInFile.length}

  Förväntat: SHARED-rader === 1 (loser-workers ska INTE ha tagit sig in)
  Status: ${sharedInFile.length === 1 ? "✅ PASS" : "❌ FAIL  (för många SHARED — race lakage!)"}
  Status: ${corruptLines.length === 0 ? "✅ JSONL integritet OK" : "❌ KORRUPT JSONL"}

────────────────────────────────────────────────────────────────
Prestanda
────────────────────────────────────────────────────────────────
  Lyckade claims totalt:             ${wonAttempts.length}
  Försök till framgång (avg/p50/p95/max):
    ${avg(wonAttempts).toFixed(2)} / ${pct(wonAttempts, 0.5)} / ${pct(wonAttempts, 0.95)} / ${max(wonAttempts)}
  Tid till framgång ms (avg/p50/p95/max):
    ${avg(wonMs).toFixed(0)} / ${pct(wonMs, 0.5)} / ${pct(wonMs, 0.95)} / ${max(wonMs)}

  Total throughput:                  ${(wonAttempts.length / (Number(TOTAL_MS) / 1000)).toFixed(1)} claims/s
================================================================
`;

console.log(report);

import { writeFileSync } from "node:fs";
writeFileSync(join(import.meta.dirname ?? __dirname, "results.md"), report);
