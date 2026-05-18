#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const [ROOT, NUM_WORKERS, SOLO_PER_WORKER, TOTAL_MS] = process.argv.slice(2);
const n = Number(NUM_WORKERS);
const solo = Number(SOLO_PER_WORKER);

const all = [];
for (let i = 1; i <= n; i++) {
  const f = join(ROOT, `result-${i}.json`);
  if (!existsSync(f) || readFileSync(f, "utf8").trim() === "") continue;
  all.push(JSON.parse(readFileSync(f, "utf8")));
}
const claims = all.flatMap((r) => r.results.map((c) => ({ user: r.user, ...c })));
const shared = claims.filter((c) => c.type === "shared");
const sharedWon = shared.filter((c) => c.won);
const sharedLost = shared.filter((c) => !c.won);
const soloAll = claims.filter((c) => c.type === "solo");
const soloWon = soloAll.filter((c) => c.won);

execSync(`git clone --quiet ${ROOT}/origin.git ${ROOT}/verify`, { stdio: "ignore" });
const claimsDir = `${ROOT}/verify/claims`;
const files = readdirSync(claimsDir).filter((f) => f.endsWith(".json"));
const sharedFiles = files.filter((f) => f.startsWith("evt-shared-001"));
const soloFiles = files.filter((f) => f.startsWith("solo-"));

const wonAttempts = claims.filter((c) => c.won).map((c) => c.attempts);
const wonMs = claims.filter((c) => c.won).map((c) => c.ms);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const max = (xs) => (xs.length ? Math.max(...xs) : 0);
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length * p)]; };

const report = `
================================================================
SPIKE: claim-race (VARIANT: claim-per-fil)
================================================================
Workers: ${n}, solo/worker: ${solo}, wall clock: ${TOTAL_MS} ms

Korrekthet SHARED (${n} tävlare):
  Vinnare: ${sharedWon.length} (förväntat 1) ${sharedWon.length === 1 ? "✅" : "❌"}
  Förlorare: ${sharedLost.length} (förväntat ${n - 1}) ${sharedLost.length === n - 1 ? "✅" : "❌"}

Korrekthet SOLO (${n}×${solo} unika):
  Lyckade: ${soloWon.length}/${n * solo} ${soloWon.length === n * solo ? "✅" : "❌"}

Datafiler i remote:
  SHARED-filer (förväntat 1): ${sharedFiles.length} ${sharedFiles.length === 1 ? "✅" : "❌"}
  SOLO-filer (förväntat ${n * solo}): ${soloFiles.length} ${soloFiles.length === n * solo ? "✅" : "❌"}

Prestanda (lyckade claims):
  Försök avg/p50/p95/max: ${avg(wonAttempts).toFixed(2)} / ${pct(wonAttempts, 0.5)} / ${pct(wonAttempts, 0.95)} / ${max(wonAttempts)}
  Tid ms avg/p50/p95/max: ${avg(wonMs).toFixed(0)} / ${pct(wonMs, 0.5)} / ${pct(wonMs, 0.95)} / ${max(wonMs)}
  Throughput: ${(wonAttempts.length / (Number(TOTAL_MS) / 1000)).toFixed(1)} claims/s
================================================================
`;
console.log(report);
writeFileSync(join(import.meta.dirname ?? __dirname, "results-perfile.md"), report);
