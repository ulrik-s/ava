#!/usr/bin/env bun
/**
 * `ava-mcp` — MCP-server-bin (stdio) på `@modelcontextprotocol/server` (SDK v2,
 * spec-revision 2026-07-28).
 *
 * Exponerar hela `appRouter`-ytan som MCP-verktyg så en AI kan anropa AVA
 * direkt. Registrera i Claude Code med
 * `claude mcp add --scope project ava -- bun tooling/ava-cli/ava-mcp.ts`.
 *
 * `serveStdio` äger epok-beslutet: öppningsanropet avgör om uppkopplingen
 * serveras modernt (per-request `_meta`, `server/discover`) eller legacy
 * (`initialize`), och EN instans ur factoryn pinnas för uppkopplingens livstid.
 * `legacy: "serve"` är default och behålls medvetet — en legacy-klient mot en
 * modern-only-server misslyckas, och har ingen fall-forward-mekanism. Läge:
 * remote om AVA_SERVER_URL + AVA_TOKEN finns, annars local (seedad sandlåda).
 *
 * OBS: stdout är JSON-RPC-ramen. All loggning måste gå till stderr — ett enda
 * `console.log` här dödar protokollet tyst.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createLocalCaller, createRemoteCaller, type AvaCaller } from "./caller";
import { listProcedures, procedureTypeMap } from "./introspect";
import { buildAvaMcpServer } from "./mcp";

function makeCaller(): AvaCaller {
  const serverUrl = process.env.AVA_SERVER_URL;
  const token = process.env.AVA_TOKEN;
  if (serverUrl && token) return createRemoteCaller({ serverUrl, token }, procedureTypeMap(listProcedures()));
  return createLocalCaller();
}

const procedures = listProcedures();
// Callern byggs EN gång, utanför factoryn: den seedade storen (local) ska
// överleva epok-valet, så mutationer inom en session är synliga för nästa anrop.
const caller = makeCaller();

serveStdio(() => buildAvaMcpServer(procedures, caller), { legacy: "serve" });
