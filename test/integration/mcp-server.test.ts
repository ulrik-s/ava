/**
 * MCP-serverns protokollyta, båda epokerna, in-process (#1006).
 *
 * Fram till nu fanns inget test som ens STARTADE servern — enhetstesterna
 * fejkade callern och protokollet var oprövat. Här kopplas en riktig klient mot
 * den riktiga serverwiringen över `InMemoryTransport`, med den riktiga
 * local-callern mot den seedade storen. Ingen process spawnas (det gör
 * `test/scripts/ava-mcp-stdio.test.ts`), så testet är parallell-säkert.
 *
 * Epokerna (spec-revision 2026-07-28):
 *   - MODERN — ingen handskakning; varje request bär sin version i `_meta` och
 *     `server/discover` är obligatorisk. Klienten når hit med
 *     `versionNegotiation: { mode: "auto" }`.
 *   - LEGACY — `initialize`-handskakningen (≤ 2025-11-25). Klientens DEFAULT,
 *     även i den officiella v2-klienten — därför är den vägen inte en
 *     bakåtkompatibilitetskuriosa utan huvudvägen i dag.
 *
 * Samma factory serverar båda; `serveStdio` väljer epok på öppningsanropet.
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { describe, it, expect } from "vitest-compat";
import { createLocalCaller } from "../../tooling/ava-cli/caller";
import { listProcedures } from "../../tooling/ava-cli/introspect";
import { buildAvaMcpServer, MCP_SERVER_NAME, toolName } from "../../tooling/ava-cli/mcp";

type Era = "modern" | "legacy";

interface Connected {
  client: Client;
  close: () => Promise<void>;
}

/**
 * Koppla upp en klient mot en färsk server över ett in-memory-transportpar.
 * `serveStdio` tar emot transporten via `options.transport` — så epok-routingen
 * som körs i produktion är exakt den som testas här.
 */
async function connect(era: Era): Promise<Connected> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const caller = createLocalCaller();
  const handle = serveStdio(() => buildAvaMcpServer(listProcedures(), caller), {
    transport: serverTransport,
    legacy: "serve",
  });
  const client = new Client(
    { name: "test", version: "0" },
    era === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await handle.close();
      await caller.close();
    },
  };
}

/** Text-innehållet ur ett verktygssvar (vår `executeToolCall`-konvention). */
function textOf(result: { content: unknown }): string {
  const blocks = result.content as { type: string; text?: string }[];
  return blocks.map((b) => b.text ?? "").join("");
}

describe.each<Era>(["legacy", "modern"])("ava-mcp över %s-epoken", (era) => {
  it("förhandlar rätt epok", async () => {
    const { client, close } = await connect(era);
    try {
      // `getProtocolEra()` är klientens egen klassning: 'modern' = 2026-07-28+
      // via server/discover, 'legacy' = initialize-handskakningen.
      expect(client.getProtocolEra()).toBe(era);
      expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
    } finally {
      await close();
    }
  });

  it("exponerar hela appRouter-ytan som verktyg", async () => {
    const { client, close } = await connect(era);
    try {
      const { tools } = await client.listTools();
      const procs = listProcedures();
      expect(tools).toHaveLength(procs.length);
      expect(tools.map((t) => t.name).sort()).toEqual(procs.map((p) => toolName(p.path)).sort());
      // Varje verktyg måste bära ett objekt-schema — MCP tillåter inget annat.
      for (const t of tools) expect(t.inputSchema.type, `${t.name} inputSchema`).toBe("object");
    } finally {
      await close();
    }
  });

  it("annoterar queries som läsande och mutationer som muterande", async () => {
    const { client, close } = await connect(era);
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));
      expect(byName.get("matter__list")?.annotations?.readOnlyHint).toBe(true);
      expect(byName.get("timeEntry__create")?.annotations?.readOnlyHint).toBe(false);
      expect(byName.get("timeEntry__create")?.annotations?.destructiveHint).toBe(true);
    } finally {
      await close();
    }
  });

  it("en query når routern och returnerar seedad data", async () => {
    const { client, close } = await connect(era);
    try {
      const res = await client.callTool({ name: "matter__list", arguments: {} });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(textOf(res)) as { matters: unknown[]; total: number };
      expect(data.matters.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("en mutation skriver, och skrivningen syns i nästa anrop", async () => {
    const { client, close } = await connect(era);
    try {
      // Ärendet hämtas ur seeden i stället för att hårdkodas (#972): en post på
      // ett påhittat matterId skapas utan att synas i någon lista.
      const matters = JSON.parse(textOf(await client.callTool({ name: "matter__list", arguments: {} })));
      const matterId = (matters as { matters: { id: string }[] }).matters[0]!.id;
      const created = await client.callTool({
        name: "timeEntry__create",
        arguments: { matterId, date: "2026-08-13", minutes: 45, description: "MCP-test" },
      });
      expect(created.isError).toBeFalsy();
      const entry = JSON.parse(textOf(created)) as { id: string; minutes: number };
      expect(entry.minutes).toBe(45);
      // Callern lever över anropen (en instans per uppkoppling) → posten finns kvar.
      const listed = await client.callTool({ name: "timeEntry__list", arguments: { matterId } });
      expect(textOf(listed)).toContain(entry.id);
    } finally {
      await close();
    }
  });

  it("ogiltig input → verktygsfel, inte protokollfel", async () => {
    // Spec-revisionen är uttrycklig: valideringsfel ska nå modellen som
    // verktygsfel så den kan rätta sig själv, inte som ett JSON-RPC-fel.
    const { client, close } = await connect(era);
    try {
      const res = await client.callTool({ name: "matter__list", arguments: { page: "inte-ett-tal" } });
      expect(res.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("okänt verktyg avvisas", async () => {
    const { client, close } = await connect(era);
    try {
      await expect(client.callTool({ name: "finns__inte", arguments: {} })).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
