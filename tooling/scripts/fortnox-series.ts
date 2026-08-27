#!/usr/bin/env bun
/**
 * `bun run fortnox:series` — lista och skapa verifikatserier (#1035).
 *
 * ## Varför CI behöver en egen serie
 *
 * Fortnox API har varken DELETE eller PUT för verifikat. I GUI:t går det
 * däremot ALLTID att ta bort det sista verifikatet i en serie — ska ett
 * verifikat mitt i serien bort måste alla med högre nummer tas bort först.
 * Ligger CI:s testverifikat i byråns skarpa serie blir de alltså i praktiken
 * omöjliga att städa. I en egen serie skalas de av bakifrån.
 *
 * ## Manual-fällan
 *
 * En serie med `Manual: false` (t.ex. `B` "Kundfakturor") är reserverad för
 * Fortnox egna automatposter och tar inte emot manuella verifikat. CI-serien
 * måste vara manuell, som `A` "Redovisning". Listningen visar flaggan.
 *
 * Lokalt adminverktyg — körs inte i CI. Skriver ut den roterade refresh-token:en
 * på stdout eftersom du behöver den för att uppdatera secreten.
 *
 *   bun run fortnox:series                      # lista serierna
 *   bun run fortnox:series --create Z "CI-test" # skapa CI-serien
 */

import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { buildConfig, connect } from "./fortnox-harness";

/** `--create <kod> [beskrivning]` ur argv, eller null för listläge. */
function parseCreate(argv: readonly string[]): { code: string; description: string } | null {
  const at = argv.indexOf("--create");
  if (at === -1) return null;
  const code = argv[at + 1];
  if (!code) {
    console.error("✗ --create kräver en seriekod, t.ex. `--create Z \"CI-testverifikat\"`.");
    process.exit(2);
  }
  return { code, description: argv[at + 2] ?? "CI-testverifikat (AVA)" };
}

/** Hur en serie ska läsas: `Manual: false` avvisar manuella verifikat. */
function manualLabel(manual: boolean | undefined): string {
  if (manual === true) return "manuell";
  return manual === false ? "AUTOMAT — tar inte manuella verifikat" : "okänd";
}

async function runCreate(client: FortnoxClient, create: { code: string; description: string }): Promise<void> {
  const created = await client.createVoucherSeries(create.code, create.description);
  console.log(`✓ Serie ${created.Code} skapad: ${created.Description ?? ""}`);
  console.log(`  Manual: ${manualLabel(created.Manual)} — måste vara manuell för att ta våra verifikat.`);
  console.log(`\nSätt repo-variabeln AVA_FORTNOX_VOUCHER_SERIES=${created.Code}.`);
}

async function runList(client: FortnoxClient): Promise<void> {
  const series = await client.listVoucherSeries();
  console.log(`Verifikatserier (${series.length}):\n`);
  for (const s of series) {
    console.log(`  ${s.Code.padEnd(4)} ${(s.Description ?? "").padEnd(28)} ${manualLabel(s.Manual)}`);
  }
  console.log("\nSkapa CI-serien med:  bun run fortnox:series --create Z \"CI-testverifikat\"");
}

async function main(): Promise<void> {
  const { client, store } = connect(buildConfig());
  const create = parseCreate(process.argv.slice(2));

  await (create ? runCreate(client, create) : runList(client));

  // Token:en roterade i anropet ovan — utan write-back kan nästa körning inte auth:a.
  const rotated = await store.load();
  if (rotated) console.log(`\n! Refresh-token roterade. Nytt värde: ${rotated.refreshToken}`);
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
