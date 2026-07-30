# ADR 0035 — `ava`-CLI + MCP-server över appRouter

**Status:** Föreslagen (PoC) · **Datum:** 2026-07-30 · **Issue:** #913

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
- **`mcp.ts`** — rena JSON-RPC-hanterare; varje procedur blir ett MCP-verktyg.

Bin:ar: `ava.ts` (CLI) och `ava-mcp.ts` (MCP stdio-server). Scripts: `bun run
ava …`, `bun run ava:mcp`.

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
- MCP-protokollet är handrollat i PoC:en (initialize/tools.list/tools.call/ping);
  skarp version bör byta till `@modelcontextprotocol/sdk`.
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
