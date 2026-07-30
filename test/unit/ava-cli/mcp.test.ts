/**
 * MCP-byggblock (protokollet ägs av @modelcontextprotocol/sdk i bin:en).
 * Fejkar callern → verifierar verktygsmappning + exekvering utan server.
 */

import { describe, it, expect } from "vitest-compat";
import type { AvaCaller } from "../../../tooling/ava-cli/caller";
import type { ProcedureInfo } from "../../../tooling/ava-cli/introspect";
import { executeToolCall, listTools, pathFromTool, toolName } from "../../../tooling/ava-cli/mcp";

const PROCS: ProcedureInfo[] = [
  { path: "invoice.list", type: "query", inputSchema: { type: "object", properties: { status: { type: "string" } } } },
  { path: "contacts.getById", type: "query", inputSchema: null },
];

function fakeCaller(overrides: Partial<AvaCaller> = {}): AvaCaller {
  return {
    invoke: (path, input) => Promise.resolve({ path, input }),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

describe("toolName/pathFromTool", () => {
  it("kodar/avkodar path", () => {
    expect(toolName("invoice.list")).toBe("invoice__list");
    expect(pathFromTool("invoice__list")).toBe("invoice.list");
  });
});

describe("listTools", () => {
  it("mappar procedurer → verktyg (behåller objekt-schema)", () => {
    const tools = listTools(PROCS);
    expect(tools[0]).toEqual({
      name: "invoice__list",
      description: "query invoice.list",
      inputSchema: { type: "object", properties: { status: { type: "string" } } },
    });
  });

  it("null/icke-objekt-schema → tomt objekt-schema (MCP kräver objekt)", () => {
    const tools = listTools(PROCS);
    expect(tools[1]?.inputSchema).toEqual({ type: "object" });
  });
});

describe("executeToolCall", () => {
  it("mappar verktygsnamn → path och wrappar resultatet som text-content", async () => {
    const res = await executeToolCall("invoice__list", { status: "SENT" }, fakeCaller());
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text)).toEqual({ path: "invoice.list", input: { status: "SENT" } });
  });

  it("saknade argument → tomt objekt", async () => {
    const res = await executeToolCall("contacts__getById", undefined, fakeCaller());
    expect(JSON.parse(res.content[0]!.text)).toEqual({ path: "contacts.getById", input: {} });
  });

  it("caller-fel → isError-content", async () => {
    const res = await executeToolCall("invoice__list", {}, fakeCaller({ invoke: () => Promise.reject(new Error("nekad")) }));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("nekad");
  });
});
