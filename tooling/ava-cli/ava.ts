#!/usr/bin/env bun
/**
 * `ava` — CLI-bin. Tunt skal runt `parseArgs`/`runParsed` (cli.ts): löser
 * `--input @fil`/`-`, väljer local/remote-caller och skriver resultatet.
 *
 * Local (default): in-process mot seedad store — ingen server, ingen auth.
 * Remote (`--remote`): server-first över HTTP; kräver AVA_SERVER_URL + AVA_TOKEN.
 */

import { readFileSync } from "node:fs";
import { createLocalCaller, createRemoteCaller, type AvaCaller } from "./caller";
import { parseArgs, runParsed, type Mode, type RunDeps } from "./cli";
import { listProcedures, procedureTypeMap } from "./introspect";

/** `-` → stdin, `@fil` → filens innehåll, annars värdet oförändrat. */
function readInputValue(v: string): string {
  if (v === "-") return readFileSync(0, "utf8");
  if (v.startsWith("@")) return readFileSync(v.slice(1), "utf8");
  return v;
}

/** Lös upp `--input`-värdet (fil/stdin) innan den rena parsern körs. */
function preprocess(argv: readonly string[]): string[] {
  return argv.map((a, i) => {
    if (a.startsWith("--input=")) return `--input=${readInputValue(a.slice("--input=".length))}`;
    if (i > 0 && argv[i - 1] === "--input") return readInputValue(a);
    return a;
  });
}

function openCaller(mode: Mode): AvaCaller {
  if (mode === "remote") {
    const serverUrl = process.env.AVA_SERVER_URL;
    const token = process.env.AVA_TOKEN;
    if (!serverUrl || !token) {
      throw new Error("--remote kräver AVA_SERVER_URL och AVA_TOKEN i miljön.");
    }
    return createRemoteCaller({ serverUrl, token }, procedureTypeMap(listProcedures()));
  }
  return createLocalCaller();
}

async function main(): Promise<void> {
  const deps: RunDeps = { procedures: listProcedures(), openCaller };
  const res = await runParsed(parseArgs(preprocess(process.argv.slice(2))), deps);
  if (res.stdout) process.stdout.write(`${res.stdout}\n`);
  if (res.stderr) process.stderr.write(`${res.stderr}\n`);
  process.exit(res.code);
}

void main();
