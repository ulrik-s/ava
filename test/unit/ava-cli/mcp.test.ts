/**
 * MCP-meddelandehanterare. Fejkar callern → verifierar protokoll-formen
 * (initialize/tools.list/tools.call) utan server.
 */

import { describe, it, expect } from "vitest-compat";
import type { AvaCaller } from "../../../tooling/ava-cli/caller";
import type { ProcedureInfo } from "../../../tooling/ava-cli/introspect";
import {
  handleMessage,
  listTools,
  MCP_PROTOCOL_VERSION,
  pathFromTool,
  toolName,
  type McpDeps,
} from "../../../tooling/ava-cli/mcp";

const PROCS: ProcedureInfo[] = [
  { path: "invoice.list", type: "query", inputSchema: { type: "object" } },
  { path: "contacts.getById", type: "query", inputSchema: null },
];

function deps(overrides: Partial<AvaCaller> = {}): McpDeps {
  const caller: AvaCaller = {
    invoke: (path, input) => Promise.resolve({ path, input }),
    close: () => Promise.resolve(),
    ...overrides,
  };
  return { procedures: PROCS, caller, serverInfo: { name: "ava-mcp", version: "0.1.0" } };
}

describe("toolName/pathFromTool", () => {
  it("kodar/avkodar path", () => {
    expect(toolName("invoice.list")).toBe("invoice__list");
    expect(pathFromTool("invoice__list")).toBe("invoice.list");
  });
});

describe("listTools", () => {
  it("mappar procedurer → verktyg (null-schema → tomt objekt-schema)", () => {
    const tools = listTools(PROCS);
    expect(tools[0]).toEqual({ name: "invoice__list", description: "query invoice.list", inputSchema: { type: "object" } });
    expect(tools[1]?.inputSchema).toEqual({ type: "object" });
  });
});

describe("handleMessage", () => {
  it("initialize returnerar protokoll + serverInfo", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, deps());
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "ava-mcp", version: "0.1.0" } },
    });
  });

  it("tools/list listar alla procedurer", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps());
    const result = res?.result as { tools: unknown[] };
    expect(result.tools).toHaveLength(2);
  });

  it("tools/call anropar callern och wrappar resultatet som text-content", async () => {
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "invoice__list", arguments: { status: "SENT" } } },
      deps(),
    );
    const result = res?.result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ path: "invoice.list", input: { status: "SENT" } });
  });

  it("tools/call med caller-fel → isError-content (inte JSON-RPC-error)", async () => {
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "invoice__list", arguments: {} } },
      deps({ invoke: () => Promise.reject(new Error("nekad")) }),
    );
    const result = res?.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("nekad");
  });

  it("notifikation (utan id) → inget svar", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, deps());
    expect(res).toBeNull();
  });

  it("okänd metod → -32601", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 5, method: "does/not/exist" }, deps());
    expect(res?.error?.code).toBe(-32601);
  });

  it("ping → tomt resultat", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 6, method: "ping" }, deps());
    expect(res?.result).toEqual({});
  });
});
