/**
 * `mcp` — MCP-serverns yta över `appRouter` (Model Context Protocol).
 *
 * Protokollet ägs av `@modelcontextprotocol/server` (SDK v2, spec-revision
 * **2026-07-28**); här bor bara mappningen procedur → verktyg och exekveringen
 * via samma `AvaCaller` som CLI:t. Noll duplicerad affärslogik.
 *
 * Epoker (spec:ens egna ord): **modern** = 2026-07-28+, där varje request bär
 * sin version i `_meta` och `server/discover` ersätter handskakningen;
 * **legacy** = 2025-11-25 och äldre, med `initialize`. Bin:en (`ava-mcp.ts`)
 * serverar BÅDA ur samma factory — en legacy-klient mot en modern-only-server
 * misslyckas enligt spec:ens kompatibilitetsmatris, och har ingen
 * fall-forward. Verktygen definieras alltså en gång, oberoende av epok.
 */

import { fromJsonSchema, McpServer, type CallToolResult, type JsonSchemaType, type ToolAnnotations } from "@modelcontextprotocol/server";
import type { AvaCaller } from "./caller";
import type { ProcedureInfo, ProcedureType } from "./introspect";
import { toolDescription, withPageSizeDefault } from "./tool-descriptions";
import { toolOutputJsonSchema } from "./tool-outputs";
import { projectToolResult } from "./tool-projections";

export const MCP_SERVER_NAME = "ava";
export const MCP_SERVER_VERSION = "0.2.0";

/** MCP-verktygsnamn tillåter inte `.` → koda path som `router__proc`. */
export function toolName(path: string): string {
  return path.replace(/\./g, "__");
}
export function pathFromTool(name: string): string {
  return name.replace(/__/g, ".");
}

/**
 * MCP kräver ett objekt-inputSchema. Alla 151 procedurer har objekt-input;
 * de 21 som saknar `.input()` helt får ett tomt objekt-schema.
 */
export function toolInputSchema(schema: unknown): JsonSchemaType {
  if (schema !== null && typeof schema === "object" && (schema as { type?: unknown }).type === "object") {
    return schema as JsonSchemaType;
  }
  return { type: "object" };
}

/**
 * Annotations ur procedurtypen. En AI som ser vilka verktyg som muterar kan
 * bete sig försiktigare — utan dem är `matter.list` och `invoice.void`
 * omöjliga att skilja åt före anropet.
 */
export function toolAnnotations(type: ProcedureType): ToolAnnotations {
  const readOnly = type === "query";
  return { readOnlyHint: readOnly, destructiveHint: !readOnly };
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Exekvera ett verktygsanrop: mappa tillbaka verktygsnamn → path och kör via
 * callern. Fel returneras som `isError`-content (MCP-konvention), inte som ett
 * protokoll-fel — spec:en är uttrycklig om att valideringsfel ska nå modellen
 * som verktygsfel så den kan rätta sig själv.
 *
 * Verktyg med svarskontrakt (#1012) fyller BÅDE `structuredContent` (samma
 * data, JSON-serialiserad så `Date` blir ISO-sträng) och text-`content` — SDK:n
 * lämnar annars `content` tom när `outputSchema` finns, och en klient som bara
 * läser text ser då ingenting.
 */
/** Bygg verktygssvaret ur callerns data (utbruten: complexity ≤ 8). */
function toolResult(data: unknown, structured: boolean): McpToolResult {
  const text = JSON.stringify(data ?? null, null, 2);
  const result: McpToolResult = { content: [{ type: "text", text }] };
  if (structured && data !== null && typeof data === "object" && !Array.isArray(data)) {
    // JSON-rundresan är serialiseringen: Date → ISO-sträng, undefined faller
    // bort — exakt det annonserade kontraktets form.
    result.structuredContent = JSON.parse(text) as Record<string, unknown>;
  }
  return result;
}

export async function executeToolCall(
  name: string,
  args: unknown,
  caller: AvaCaller,
  opts: { structured?: boolean } = {},
): Promise<McpToolResult> {
  try {
    const path = pathFromTool(name);
    // Projektionen (#1014) sitter HÄR och inte i routern: listraderna är
    // join-tunga för att UI:t behöver dem så, medan modellen betalar för varje
    // fält den inte bad om. Detaljer hämtas via `getById`.
    const data = projectToolResult(path, await caller.invoke(path, args ?? {}));
    return toolResult(data, opts.structured === true);
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

/**
 * Hela `appRouter`-ytan som en registrerad `McpServer`. Ren fabrik (ingen I/O,
 * ingen transport) → testbar över `InMemoryTransport` utan att spawna en
 * process, och återanvändbar av `serveStdio`-factoryn som bygger EN instans
 * per uppkoppling.
 */
export function buildAvaMcpServer(procs: readonly ProcedureInfo[], caller: AvaCaller): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } });
  for (const p of procs) {
    const name = toolName(p.path);
    const outputSchema = toolOutputJsonSchema(p.path);
    server.registerTool(
      name,
      {
        description: toolDescription(p),
        inputSchema: fromJsonSchema(toolInputSchema(p.inputSchema)),
        ...(outputSchema ? { outputSchema: fromJsonSchema(outputSchema as JsonSchemaType) } : {}),
        annotations: toolAnnotations(p.type),
      },
      (args: unknown): Promise<CallToolResult> =>
        executeToolCall(name, withPageSizeDefault(p.inputSchema, args), caller, { structured: outputSchema !== null }) as Promise<CallToolResult>,
    );
  }
  return server;
}
