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
import { MCP_DEFAULT_PAGE_SIZE } from "../../tooling/ava-cli/tool-descriptions";
import { outputDescribedPaths } from "../../tooling/ava-cli/tool-outputs";

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

/**
 * Datumfält över JSON (#1010). Före `z.coerce.date()` avvisade dessa
 * procedurer varje ISO-sträng — `calendar.create` och `task.create` gick
 * bokstavligen inte att använda från en JSON-klient, och `timeEntry.list`
 * kunde inte begränsas till en period.
 */
describe("datum över MCP (#1010)", () => {
  it("calendar.create tar ISO-strängar och skapar händelsen", async () => {
    const { client, close } = await connect("legacy");
    try {
      const created = await client.callTool({
        name: "calendar__create",
        arguments: { title: "Huvudförhandling", startAt: "2026-09-01T09:00:00.000Z", endAt: "2026-09-01T11:00:00.000Z" },
      });
      expect(created.isError, textOf(created)).toBeFalsy();
      const ev = JSON.parse(textOf(created)) as { id: string; startAt: string };
      expect(new Date(ev.startAt).toISOString()).toBe("2026-09-01T09:00:00.000Z");
      // Skrivningen är verklig: händelsen syns i listan.
      const listed = await client.callTool({ name: "calendar__list", arguments: {} });
      expect(textOf(listed)).toContain(ev.id);
    } finally {
      await close();
    }
  });

  it("task.create tar en ISO-förfallodag", async () => {
    const { client, close } = await connect("legacy");
    try {
      const created = await client.callTool({
        name: "task__create",
        arguments: { title: "Överklaga prutningen", dueAt: "2026-09-15T12:00:00.000Z" },
      });
      expect(created.isError, textOf(created)).toBeFalsy();
      expect(new Date((JSON.parse(textOf(created)) as { dueAt: string }).dueAt).getUTCDate()).toBe(15);
    } finally {
      await close();
    }
  });

  it("timeEntry.list kan begränsas till en period med ISO-strängar", async () => {
    const { client, close } = await connect("legacy");
    try {
      const all = JSON.parse(textOf(await client.callTool({ name: "timeEntry__list", arguments: { pageSize: 100 } }))) as { total: number };
      const none = JSON.parse(textOf(await client.callTool({
        name: "timeEntry__list",
        arguments: { from: "1990-01-01T00:00:00.000Z", to: "1990-12-31T00:00:00.000Z" },
      }))) as { total: number };
      expect(none.total).toBe(0);
      expect(all.total).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});

/**
 * Svarskontrakt (#1012). Verktyg med kontrakt annonserar `outputSchema` och
 * svarar med BÅDE `structuredContent` och text-`content` — SDK:n lämnar annars
 * `content` tom när `outputSchema` finns, och en klient som bara läser text
 * ser då ingenting. SDK:n validerar dessutom `structuredContent` mot schemat
 * vid varje anrop, så kontraktet är en levande grind, inte dokumentation.
 */
describe("svarskontrakt (#1012)", () => {
  it("läse-ytan annonserar outputSchema, resten inte", async () => {
    const { client, close } = await connect("legacy");
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));
      for (const path of outputDescribedPaths()) {
        expect(byName.get(toolName(path))?.outputSchema?.type, path).toBe("object");
      }
      expect(byName.get("billingRun__list")?.outputSchema).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("svaret bär både structuredContent och samma data som text", async () => {
    const { client, close } = await connect("legacy");
    try {
      const res = await client.callTool({ name: "matter__list", arguments: {} });
      expect(res.isError, textOf(res)).toBeFalsy();
      const structured = res.structuredContent as { matters: { id: string }[]; total: number };
      expect(structured.matters.length).toBeGreaterThan(0);
      // Texten är samma data — klienter som bara läser content förlorar inget.
      expect(JSON.parse(textOf(res))).toEqual(structured);
    } finally {
      await close();
    }
  });
});

/**
 * Sidning av de tidigare osidade listorna (#1011). Frivillig i routern —
 * utelämnad pageSize är dagens beteende, så UI:t påverkas inte — men MCP-ytan
 * skickar alltid sin snåla default.
 */
describe("sidning av listor utan egen paginering (#1011)", () => {
  it("invoice.list får MCP-defaulten i stället för hela listan", async () => {
    const { client, close } = await connect("legacy");
    try {
      const rows = JSON.parse(textOf(await client.callTool({ name: "invoice__list", arguments: {} }))) as unknown[];
      expect(rows).toHaveLength(MCP_DEFAULT_PAGE_SIZE);
      const page2 = JSON.parse(textOf(await client.callTool({ name: "invoice__list", arguments: { page: 2, pageSize: 3 } }))) as { id: string }[];
      expect(page2).toHaveLength(3);
      expect(page2[0]!.id).not.toBe((rows as { id: string }[])[0]!.id);
    } finally {
      await close();
    }
  });

  it("task.list sidas på samma sätt", async () => {
    const { client, close } = await connect("legacy");
    try {
      const rows = JSON.parse(textOf(await client.callTool({ name: "task__list", arguments: {} }))) as unknown[];
      expect(rows.length).toBeLessThanOrEqual(MCP_DEFAULT_PAGE_SIZE);
    } finally {
      await close();
    }
  });
});

/**
 * Byråöversikten över MCP (#1016) — verktyget som gör "hur går det för byrån,
 * per person?" till ETT anrop i stället för 2N+1. Körs mot demo-seeden, så
 * testet vaktar också att seeden faktiskt HAR siffror att visa.
 */
describe("reports.firmOverview över MCP (#1016)", () => {
  it("ger en rad per jurist, byråtotaler och fordringsläge i ett anrop", async () => {
    const { client, close } = await connect("legacy");
    try {
      const res = await client.callTool({
        name: "reports__firmOverview",
        arguments: { from: "2026-01-01", to: "2026-12-31" },
      });
      expect(res.isError, textOf(res)).toBeFalsy();
      // Svarskontrakt: structuredContent + text, som resten av läse-ytan.
      const data = res.structuredContent as {
        lawyers: { name: string; totalMinutes: number; billedOre: number }[];
        totals: { totalMinutes: number; billedOre: number; unbilledOre: number };
        ar: { fakturerat: number; utestaende: number };
      };
      expect(data.lawyers.length).toBeGreaterThan(1);
      expect(data.totals.totalMinutes).toBe(data.lawyers.reduce((s, l) => s + l.totalMinutes, 0));
      expect(data.totals.billedOre).toBe(data.lawyers.reduce((s, l) => s + l.billedOre, 0));
      // Demo-seeden bär riktig ekonomi — en översikt med bara nollor är trasig.
      expect(data.totals.unbilledOre).toBeGreaterThan(0);
      expect(data.ar.fakturerat).toBeGreaterThan(0);
      // #1018: attributionen kräver FRYST arbete (tidsposter med invoiceId).
      // Seeden hade fakturor utan en enda länkad post → "Fakturerat per jurist"
      // var 0 kr för alla trots fakturerat i bryggan. Minst två jurister ska
      // ha attribuerat fakturerat, annars har länkarna tappats igen.
      expect(data.lawyers.filter((l) => l.billedOre > 0).length).toBeGreaterThanOrEqual(2);
      expect(data.totals.billedOre).toBeGreaterThan(0);
      // En aggregering ska vara LITEN: långt under budget-ratchet:en.
      expect(textOf(res).length).toBeLessThan(15_000);
    } finally {
      await close();
    }
  });
});

/**
 * Utdatabudget (#1008) — en RATCHET i samma anda som bundle-size.
 *
 * MCP-klienter kapar verktygssvar (Claude Code varnar över 10 000 tokens och
 * kapar vid 25 000). Ett kapat svar är värre än ett kort: JSON:en huggs av mitt
 * i och modellen läser en halv sanning. Före #1008 låg `timeEntry.list` på
 * 61,7 KB — på demo-seedens 130 tidsposter.
 *
 * Golvet flyttas BARA nedåt: 45 000 → 38 000 när #1011 gav de sista listorna
 * sidning (`invoice.list` 43,8 → 37,2 KB). Kvarvarande värsting är
 * `invoice.list` — 10 rader à ~1 KB, join-feta rader. Nästa sänkning kräver
 * fältprojektion (#1014), inte mer sidning.
 */
const OUTPUT_BUDGET_CHARS = 38_000;

describe("verktygens utdatabudget", () => {
  it("inget verktyg som går att anropa utan argument spränger budgeten", async () => {
    const { client, close } = await connect("legacy");
    try {
      // Procedurer med obligatorisk input kan inte anropas blint — de mäts inte
      // här. Antalet asserteras så urvalet inte kan krympa tyst.
      const callable = listProcedures().filter((p) => {
        const schema = p.inputSchema as { required?: string[] } | null;
        return p.type === "query" && (schema === null || (schema.required ?? []).length === 0);
      });
      expect(callable.length).toBeGreaterThanOrEqual(22);

      const oversized: string[] = [];
      for (const p of callable) {
        const res = await client.callTool({ name: toolName(p.path), arguments: {} });
        const size = textOf(res).length;
        if (size > OUTPUT_BUDGET_CHARS) oversized.push(`${p.path}: ${size}`);
      }
      expect(oversized, `över budget (${OUTPUT_BUDGET_CHARS} tecken): ${oversized.join(", ")}`).toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);

  it("paginerade verktyg får MCP-ytans sidstorlek, inte zods egen", async () => {
    // `timeEntry.list` har pageSize-default 50 i zod → 61,7 KB. MCP-ytan
    // begränsar till 10 rader när modellen inte sagt något.
    const { client, close } = await connect("legacy");
    try {
      const res = await client.callTool({ name: "timeEntry__list", arguments: {} });
      const data = JSON.parse(textOf(res)) as { entries: unknown[]; total: number };
      expect(data.entries).toHaveLength(MCP_DEFAULT_PAGE_SIZE);
      // Totalen ska fortfarande berätta hur mycket som finns — annars vet
      // modellen inte att den bara sett en sida.
      expect(data.total).toBeGreaterThan(MCP_DEFAULT_PAGE_SIZE);
    } finally {
      await close();
    }
  });

  it("modellen kan begära fler rader själv", async () => {
    const { client, close } = await connect("legacy");
    try {
      const res = await client.callTool({ name: "timeEntry__list", arguments: { pageSize: 30 } });
      expect((JSON.parse(textOf(res)) as { entries: unknown[] }).entries).toHaveLength(30);
    } finally {
      await close();
    }
  });
});
