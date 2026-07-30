#!/usr/bin/env bun
/**
 * `ava-mcp` — MCP-server-bin (stdio) byggd på `@modelcontextprotocol/sdk`.
 *
 * Exponerar hela `appRouter`-ytan som MCP-verktyg (`tools/list` + `tools/call`)
 * så Claude kan anropa AVA som verktyg direkt. Registrera i Claude Code som en
 * MCP-server (`command: bun`, `args: ["tooling/ava-cli/ava-mcp.ts"]`).
 *
 * SDK:n äger protokollet (initialize/handshake/JSON-RPC över stdio); den rena
 * mappningen procedur → verktyg + exekvering bor i mcp.ts. Läge: remote om
 * AVA_SERVER_URL + AVA_TOKEN finns, annars local (seedad sandlåda).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type CallToolResult, CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLocalCaller, createRemoteCaller, type AvaCaller } from "./caller";
import { listProcedures, procedureTypeMap } from "./introspect";
import { executeToolCall, listTools } from "./mcp";

const VERSION = "0.1.0";

function makeCaller(): AvaCaller {
  const serverUrl = process.env.AVA_SERVER_URL;
  const token = process.env.AVA_TOKEN;
  if (serverUrl && token) return createRemoteCaller({ serverUrl, token }, procedureTypeMap(listProcedures()));
  return createLocalCaller();
}

async function main(): Promise<void> {
  const procedures = listProcedures();
  const caller = makeCaller();

  const server = new Server({ name: "ava-mcp", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: listTools(procedures) }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> =>
    // McpToolResult är strukturellt en CallToolResult (content: text-block[] + isError?);
    // SDK:ns handler-retur är en bred union → en enkel assertion undviker fel-inferens.
    (await executeToolCall(req.params.name, req.params.arguments ?? {}, caller)) as CallToolResult,
  );

  await server.connect(new StdioServerTransport());
}

void main();
