/**
 * `ava-mcp`-bin:en över RIKTIG stdio (#1006).
 *
 * Integrationstestet (`test/integration/mcp-server.test.ts`) kör samma server
 * in-process och täcker protokollet. Det här testet finns för det som bara en
 * spawnad process kan visa:
 *
 *   - shebang + ESM-upplösning under `bun` (bin:en importerar `@/`-alias och
 *     halva servern — går den ens att starta?),
 *   - **stdout-renhet**: stdout ÄR JSON-RPC-ramen. Ett enda `console.log` i
 *     någon modul bin:en drar in bryter ramningen, och felet syns inte i något
 *     in-process-test. Klienten här vägrar tolka skräp → testet blir röd.
 *   - epok-valet i skarp konfiguration (`legacy: "serve"`).
 *
 * Spawnen är ASYNKRON (transporten äger barnprocessen) → filen är parallell-
 * säker och behöver inte stå i `SERIAL_FILES` (#327).
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, it, expect } from "vitest-compat";
import { MCP_SERVER_NAME } from "../../tooling/ava-cli/mcp";

const BIN = new URL("../../tooling/ava-cli/ava-mcp.ts", import.meta.url).pathname;

async function connect(mode: "modern" | "legacy"): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client(
    { name: "stdio-test", version: "0" },
    mode === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(new StdioClientTransport({ command: "bun", args: [BIN] }));
  return { client, close: () => client.close() };
}

describe("ava-mcp som spawnad stdio-server", () => {
  it("startar, håller stdout ren och svarar på tools/list (legacy)", async () => {
    const { client, close } = await connect("legacy");
    try {
      expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(100);
      expect(tools.some((t) => t.name === "matter__list")).toBe(true);
    } finally {
      await close();
    }
  }, 60_000);

  it("serverar den moderna epoken i skarp konfiguration", async () => {
    const { client, close } = await connect("modern");
    try {
      expect(client.getProtocolEra()).toBe("modern");
      const res = await client.callTool({ name: "matter__list", arguments: {} });
      expect(res.isError).toBeFalsy();
    } finally {
      await close();
    }
  }, 60_000);
});
