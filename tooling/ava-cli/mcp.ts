/**
 * `mcp` — rena MCP-meddelandehanterare (Model Context Protocol, JSON-RPC 2.0).
 *
 * Exponerar hela `appRouter`-ytan som MCP-verktyg (`tools/list` + `tools/call`)
 * så Claude kan anropa AVA som *verktyg* direkt — hämta data, skapa fakturor
 * osv. Samma introspektion + samma `AvaCaller` som CLI:t; MCP är bara ett annat
 * skal. `handleMessage` är ren (I/O görs i bin:en `ava-mcp.ts` via stdio).
 *
 * PoC: minimal handroll av protokollet (initialize/tools.list/tools.call/ping)
 * utan SDK-beroende — logiken är testbar. Skarp version bör byta till
 * `@modelcontextprotocol/sdk` (se ADR 0035).
 */

import type { AvaCaller } from "./caller";
import type { ProcedureInfo } from "./introspect";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpDeps {
  procedures: readonly ProcedureInfo[];
  caller: AvaCaller;
  serverInfo: McpServerInfo;
}

/** Fel som mappas till JSON-RPC `-32601 Method not found`. */
class MethodNotFound extends Error {
  constructor(method: string) {
    super(`Okänd metod: ${method}`);
    this.name = "MethodNotFound";
  }
}

/** MCP-verktygsnamn tillåter inte `.` → koda path som `router__proc`. */
export function toolName(path: string): string {
  return path.replace(/\./g, "__");
}
export function pathFromTool(name: string): string {
  return name.replace(/__/g, ".");
}

/** Hela procedur-ytan som MCP-verktygsdefinitioner. */
export function listTools(procs: readonly ProcedureInfo[]): McpTool[] {
  return procs.map((p) => ({
    name: toolName(p.path),
    description: `${p.type} ${p.path}`,
    inputSchema: p.inputSchema ?? { type: "object" },
  }));
}

function callParams(params: unknown): { name: string; args: unknown } {
  if (params !== null && typeof params === "object") {
    const p = params as Record<string, unknown>;
    if (typeof p.name === "string") return { name: p.name, args: p.arguments ?? {} };
  }
  throw new Error("tools/call kräver { name, arguments }");
}

async function callTool(params: unknown, deps: McpDeps): Promise<unknown> {
  const { name, args } = callParams(params);
  try {
    const data = await deps.caller.invoke(pathFromTool(name), args);
    return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

function resultFor(method: string, params: unknown, deps: McpDeps): Promise<unknown> {
  switch (method) {
    case "initialize":
      return Promise.resolve({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: deps.serverInfo });
    case "tools/list":
      return Promise.resolve({ tools: listTools(deps.procedures) });
    case "tools/call":
      return callTool(params, deps);
    case "ping":
      return Promise.resolve({});
    default:
      return Promise.reject(new MethodNotFound(method));
  }
}

/** En request utan `id` är en notifikation (inget svar ska skickas). */
function isNotification(msg: JsonRpcMessage): boolean {
  return msg.id === undefined || msg.id === null;
}

/**
 * Hantera ett inkommande JSON-RPC-meddelande → svar (eller `null` för
 * notifikationer). Ren: all faktisk data hämtas via `deps.caller`.
 */
export async function handleMessage(msg: JsonRpcMessage, deps: McpDeps): Promise<JsonRpcResponse | null> {
  if (typeof msg.method !== "string") return null;
  const notification = isNotification(msg);
  const id = msg.id ?? null;
  try {
    const result = await resultFor(msg.method, msg.params, deps);
    return notification ? null : { jsonrpc: "2.0", id, result };
  } catch (err) {
    if (notification) return null;
    const code = err instanceof MethodNotFound ? -32601 : -32603;
    return { jsonrpc: "2.0", id, error: { code, message: err instanceof Error ? err.message : String(err) } };
  }
}
