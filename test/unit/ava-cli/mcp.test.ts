/**
 * MCP-byggblock (protokollet ägs av @modelcontextprotocol/server v2 i bin:en).
 * Fejkar callern → verifierar namnkodning, schema-normalisering, annotations
 * och exekvering utan server. Själva protokollytan testas i
 * `test/integration/mcp-server.test.ts` (båda epokerna).
 */

import { describe, it, expect } from "vitest-compat";
import type { AvaCaller } from "../../../tooling/ava-cli/caller";
import { executeToolCall, pathFromTool, toolAnnotations, toolInputSchema, toolName } from "../../../tooling/ava-cli/mcp";

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

describe("toolInputSchema", () => {
  it("behåller ett objekt-schema orört", () => {
    const schema = { type: "object", properties: { status: { type: "string" } } };
    expect(toolInputSchema(schema)).toEqual(schema);
  });

  it("null/icke-objekt-schema → tomt objekt-schema (MCP kräver objekt)", () => {
    // De 21 procedurer som saknar `.input()` helt hamnar här.
    expect(toolInputSchema(null)).toEqual({ type: "object" });
    expect(toolInputSchema({ type: "string" })).toEqual({ type: "object" });
  });
});

describe("toolAnnotations", () => {
  it("query → läsande, mutation → muterande", () => {
    // Utan dem kan en AI inte skilja `matter.list` från `invoice.void`.
    expect(toolAnnotations("query")).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(toolAnnotations("mutation")).toEqual({ readOnlyHint: false, destructiveHint: true });
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
