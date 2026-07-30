#!/usr/bin/env bun
/**
 * `ava-mcp` — MCP-server-bin (stdio). Tunt skal runt `handleMessage` (mcp.ts):
 * läser radavgränsade JSON-RPC-meddelanden från stdin, svarar på stdout.
 * Registrera i Claude Code som en MCP-server (`command: bun`, `args:
 * [tooling/ava-cli/ava-mcp.ts]`) → hela AVA-API:t blir verktyg.
 *
 * Läge: remote om AVA_SERVER_URL + AVA_TOKEN finns, annars local (sandlåda).
 */

import { createLocalCaller, createRemoteCaller, type AvaCaller } from "./caller";
import { listProcedures, procedureTypeMap } from "./introspect";
import { handleMessage, type McpDeps } from "./mcp";

const VERSION = "0.1.0";

function makeCaller(): AvaCaller {
  const serverUrl = process.env.AVA_SERVER_URL;
  const token = process.env.AVA_TOKEN;
  if (serverUrl && token) return createRemoteCaller({ serverUrl, token }, procedureTypeMap(listProcedures()));
  return createLocalCaller();
}

function main(): void {
  const deps: McpDeps = { procedures: listProcedures(), caller: makeCaller(), serverInfo: { name: "ava-mcp", version: VERSION } };
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) void dispatch(line, deps);
      nl = buf.indexOf("\n");
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

async function dispatch(line: string, deps: McpDeps): Promise<void> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignorera trasiga rader
  }
  const resp = await handleMessage(msg as Parameters<typeof handleMessage>[0], deps);
  if (resp) process.stdout.write(`${JSON.stringify(resp)}\n`);
}

main();
