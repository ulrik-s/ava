/**
 * `mcp` — rena byggblock för MCP-servern (Model Context Protocol).
 *
 * Exponerar hela `appRouter`-ytan som MCP-verktyg. Själva protokollet
 * (initialize/tools.list/tools.call, JSON-RPC-ramning över stdio) ägs av den
 * officiella `@modelcontextprotocol/sdk` i bin:en `ava-mcp.ts`; här bor bara
 * den rena, testbara mappningen procedur → verktyg + verktygsexekvering via
 * samma `AvaCaller` som CLI:t. Noll duplicerad affärslogik.
 */

import type { AvaCaller } from "./caller";
import type { ProcedureInfo } from "./introspect";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** MCP-verktygsnamn tillåter inte `.` → koda path som `router__proc`. */
export function toolName(path: string): string {
  return path.replace(/\./g, "__");
}
export function pathFromTool(name: string): string {
  return name.replace(/__/g, ".");
}

/** MCP kräver ett objekt-inputSchema; icke-objekt/null → tomt objekt-schema. */
function toolInputSchema(schema: unknown): Record<string, unknown> {
  if (schema !== null && typeof schema === "object" && (schema as { type?: unknown }).type === "object") {
    return schema as Record<string, unknown>;
  }
  return { type: "object" };
}

/** Hela procedur-ytan som MCP-verktygsdefinitioner. */
export function listTools(procs: readonly ProcedureInfo[]): McpTool[] {
  return procs.map((p) => ({
    name: toolName(p.path),
    description: `${p.type} ${p.path}`,
    inputSchema: toolInputSchema(p.inputSchema),
  }));
}

/**
 * Exekvera ett verktygsanrop: mappa tillbaka verktygsnamn → path och kör via
 * callern. Fel returneras som `isError`-content (MCP-konvention), inte som ett
 * protokoll-fel — så klienten (Claude) ser felmeddelandet.
 */
export async function executeToolCall(name: string, args: unknown, caller: AvaCaller): Promise<McpToolResult> {
  try {
    const data = await caller.invoke(pathFromTool(name), args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}
