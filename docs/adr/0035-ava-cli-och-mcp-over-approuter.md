# ADR 0035 — `ava`-CLI + MCP-server över appRouter

**Status:** Antagen · **Datum:** 2026-07-30, reviderad 2026-08-13 · **Issue:** #913, #1006

## Kontext

En AI (t.ex. Claude via Claude Code CLI) ska smidigt kunna jobba mot AVA —
hämta data, skapa fakturor, registrera tid osv. Web-appen är byggd för en
människa i en browser; en AI behöver en skriptbar, maskinläsbar yta.

Nyckelobservation: **hela applikationen *är* `appRouter`** (tRPC, 24 routrar,
`src/lib/server/routers/_app.ts`). All affärslogik, validering (zod) och
org-scoping bor där. Det finns redan två bevisade sätt att köra `appRouter`
utanför browsern:

1. **In-process caller** — `appRouter.createCaller(ctx)` mot en seedad
   in-memory-store. Används av web/demo-klienten (`in-process-link.ts`) och av
   *alla* integrationstester (`seed-smoke.test.ts`).
2. **Tunn tRPC-over-HTTP-klient** — `createTRPCClient<AppRouter>()` +
   `httpBatchLink` + superjson + Bearer-token. Används av helper-ui (ADR 0031)
   och Office-add-ins (ADR 0013). Servern accepterar Bearer-JWT för icke-browser-
   klienter (`server-context.ts` → `bearerClaims`, ADR 0028).

## Beslut

Bygg ett `ava`-CLI **och** en MCP-server som båda är *tunna frontends över
`appRouter`* — noll duplicerad affärslogik. Gemensam kärna i `tooling/ava-cli/`:

- **`introspect.ts`** — härleder kommandoytan ur `appRouter._def.procedures`
  (path + query/mutation + zod-input som JSON-schema via `z.toJSONSchema`).
  Kommandolistan är därmed **auto-härledd** och alltid i synk när routrar växer.
- **`caller.ts`** — `AvaCaller.invoke(path, input)` bakom två transporter:
  - **local** (default): in-process mot seedad store — ingen server, ingen auth.
    Offline-sandlåda för AI + CI.
  - **remote**: server-first över HTTP, `AVA_SERVER_URL` + `AVA_TOKEN` (Bearer).
- **`cli.ts`** — ren `parseArgs` + `runParsed` (I/O injiceras) → JSON in/ut.
- **`mcp.ts`** — `buildAvaMcpServer(procs, caller)`: varje procedur registreras
  som ett MCP-verktyg. Ren fabrik utan transport → testbar över
  `InMemoryTransport`.

Bin:ar: `ava.ts` (CLI) och `ava-mcp.ts` (MCP stdio-server). Scripts: `bun run
ava …`, `bun run ava:mcp`.

### Protokollet: 2026-07-28, dual-era (#1006)

MCP-spec:en är datumversionerad, och **2026-07-28** är en bakåtinkompatibel
generationsbrytning: ingen `initialize`-handskakning — varje request bär sin
version i `_meta`, och `server/discover` är obligatorisk. Spec:en kallar
epokerna **modern** (2026-07-28+) och **legacy** (≤ 2025-11-25).

Vi kör `@modelcontextprotocol/server` v2 och serverar **båda** epokerna ur
samma factory (`serveStdio(factory, { legacy: "serve" })`). Skälet är inte
sentimentalt: spec:ens kompatibilitetsmatris säger att en legacy-klient mot en
modern-only-server **misslyckas**, och legacy-klienter har ingen
fall-forward-mekanism. Och `versionNegotiation.mode` defaultar till `'legacy'`
även i den officiella v2-klienten — legacy är alltså inte en historisk
kuriosa utan huvudvägen i dag. `legacy: "reject"` är en enradsändring den dag
det ändras.

Verktygen definieras en gång och är epok-oberoende: `registerTool` med
input-schema via `fromJsonSchema` (introspektionen producerar redan JSON
Schema) och annotations ur procedurtypen — `readOnlyHint` för queries,
`destructiveHint` för mutationer, så en AI kan skilja `matter.list` från
`invoice.void` före anropet.

### Varför `tooling/` och inte `src/`

CLI:t är en *tooling/server*-artefakt (får importera server-*värden* som
`createCaller` + `buildSeed`), inte en klient. `tooling/` ligger utanför
dependency-cruisers lager-regler (`src|test|helper-ui|office-addin`), så det
undviker `ui-imports-server-by-type-only` m.fl. utan undantag.

## Konsekvenser

**Positivt**
- Full API-yta gratis; växer automatiskt med routrarna.
- `ava describe` (zod→JSON-schema) + MCP `tools/list` låter en AI *själv upptäcka*
  ytan. JSON in/ut, icke-noll exit-koder → maskinvänligt.
- Local-mode ger en säker sandlåda (och snabb CI-yta) utan server/auth.
- Samma kärna driver både CLI och MCP.

**Avvägningar / uppföljning**
- Introspektionen rör tRPC:s otypa `_def` (defensivt narrowat) — kan behöva
  justeras vid tRPC-major-uppgradering. Vaktas av enhetstester.
- Verktygsytan är auto-härledd, vilket gör UPPTÄCKBARHETEN till en funktion av
  routrarnas namngivning: beskrivningarna är i dag bara `"<typ> <path>"`, och
  151 verktyg utan semantik är svårnavigerade för en AI. Ingen grind vaktar
  det.
- Remote-auth i PoC:en är en färdig Bearer-token via env. Ett riktigt
  headless-login-flöde (OIDC client-credentials/device-code, jfr helperns
  PKCE, ADR 0028) är eget arbete.
- Wiring till alla kvalitetsgrindar (knip-entries, `deps:check`-scope,
  coverage-ratchet) tas stegvis (#913).

## Alternativ som förkastades

- **Egen REST/GraphQL-yta** — dubblerar kontrakt, drar isär från tRPC-typerna.
- **Bara MCP eller bara CLI** — CLI:t är skriptbart/komponerbart; MCP är
  smidigast för AI:n. Samma kärna ger båda billigt.
- **Direkt mot Postgres/repos** — kringgår routrarnas validering + org-scoping.
