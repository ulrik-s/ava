#!/usr/bin/env bun
/**
 * `find-double-casts` — listar alla dubbel-castar (`as unknown as` / `as any as`)
 * i kodbasen, fil:rad, för snabb manuell inventering.
 *
 * Detta är ENBART en sök-/listnings-hjälpare. Den AUKTORITATIVA gränsvakten är
 * ESLint-regeln `no-restricted-syntax` (error) i `tooling/config/eslint.config.mjs`
 * som fäller NYA dubbel-castar i CI + lokalt (`bun run lint`). Befintliga är
 * baselineade i `eslint-suppressions.json` och avvecklas i #562 (ADR 0026).
 *
 * Körs: `bun run lint:double-casts`. Exit 0 = rent, 1 = träffar finns.
 */

import { spawnSync } from "node:child_process";

const res = spawnSync(
  "git",
  ["grep", "-nE", "as unknown as|as any as", "--", "*.ts", "*.tsx"],
  { encoding: "utf8" },
);

const hits = (res.stdout ?? "")
  .split("\n")
  .filter(Boolean)
  // hoppa över rena kommentar-/dokstring-rader (regeln bryr sig bara om kod)
  .filter((line) => {
    const code = line.split(":").slice(2).join(":").trimStart();
    return !code.startsWith("*") && !code.startsWith("//") && !code.startsWith("/**");
  });

if (hits.length === 0) {
  console.log("✓ Inga dubbel-castar (`as unknown as` / `as any as`) i kodbasen.");
  process.exit(0);
}

console.log(hits.join("\n"));
console.log(
  `\n${hits.length} dubbel-cast(ar). NYA fälls av ESLint-regeln no-restricted-syntax (CI + \`bun run lint\`); ` +
    "befintliga avvecklas i #562 (ADR 0026).",
);
process.exit(1);
