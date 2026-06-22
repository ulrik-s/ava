# ADR 0031 — Helpern som tunn tRPC-klient (tRPC överallt, delade typer i alla tiers)

- **Status:** Accepterad (2026-06-22)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** helper-ui (motorn), helper-protokollet, web-appens dokument-öppnings-flöde,
  dependency-cruiser, server-first document-procedurer.
- **Knyter an:** [ADR 0013](0013-tunn-server-trpc-over-http-add-ins.md) (add-ins =
  tunna tRPC-over-HTTP-klienter — **samma mönster**), [ADR 0028](0028-autonom-offline-first-helper.md)
  (helperns egna Bearer), [ADR 0027](0027-kapabilitets-tierad-klient.md) (tiers),
  [ADR 0030](0030-konsolidera-helper-till-ett-paket.md) (ett paket).

## Kontext

När web-appen ber AVA Helper öppna ett dokument fick helpern en **REST-URL**
(`/api/documents/<id>/download`) som downloadUrl. Men server-first exponerar
**bara tRPC** (`/api/trpc`) — dokument-bytes hämtas via den typade proceduren
`document.downloadContent` och skrivs via `document.uploadContent`. REST-URL:en
fanns aldrig → **404**, och 1-klicks-öppning i native-app föll tillbaka i
self-hosted.

Att lägga till en bespoke REST-yta i server-first vore att skapa ett **andra,
otypat kontrakt** vid sidan av tRPC — raka motsatsen till projektets princip att
**alla lager och tiers delar datatyper** (strikt zod + `AppRouter`). Dessutom är
mönstret redan etablerat: **Office-add-ins är tunna tRPC-over-HTTP-klienter**
(ADR 0013). Och auth-gaten accepterar numera helperns egna Bearer (oauth2-proxy
`SKIP_JWT_BEARER_TOKENS`, #699 + `offline_access`-roll #700) — bevisat med 202 mot
`/api/trpc`-gaten.

## Beslut

### 1. Helpern är en tunn tRPC-over-HTTP-klient

Helpern hämtar dokument via `document.downloadContent` och skriver via
`document.uploadContent` — samma typade procedurer som web-appen och add-ins
använder. **Ingen bespoke REST-yta.** Helpern bygger en `createTRPCClient<AppRouter>`
(httpBatchLink + superjson), exakt som `createAddinClient` (ADR 0013).

### 2. Web-appen skickar `documentId`, inte en REST-URL

Web-appen slutar konstruera `/api/documents/<id>/download`-URL:er åt helpern. Den
skickar **`documentId` + tRPC-endpoint** (`<origin>/api/trpc`); helpern bär sin
**egna** Bearer (OIDC-token, ADR 0028 §2) i `Authorization`-headern. Allt typat
end-to-end via `AppRouter`.

### 3. Delade datatyper i ALLA tiers; transport = tRPC där en server finns

`AppRouter` + zod-scheman delas i alla tiers. **Transporten** är tRPC-over-HTTP
överallt det finns en server (self-hosted + framtida hosted). **Demo-tiern har
ingen server** — hela routern kör i webbläsaren mot `DemoDataStore`, och
dokument-bytsen är statiska filer i GH-Pages-exporten. Där hämtar helpern en
**statisk blob-URL** (oförändrat). Det är ett transport-undantag, inte ett
typ-undantag: typerna/kontraktet delas även i demo.

### 4. dep-cruiser: helper-ui får type-only-importera `server/`

Som add-ins (`addin-imports-server-by-type-only`) får `helper-ui` **type-only**-
importera `src/lib/server/` (enbart `AppRouter`-typen, raderas vid kompilering —
ingen runtime-koppling). Värde-importer av server- eller client-kod förblir
förbjudna; helpern har sin **egen** tRPC-klient-factory (kan inte återanvända
`src/lib/client/addin/`, som ligger bakom client-gränsen).

## Konsekvenser

- **Ett enda typat kontrakt** för dokument-IO i alla server-tiers; ingen otypad
  REST att hålla i synk.
- `helper-ui` får dependencies `@trpc/client` + `superjson` (+ `@trpc/server` som
  typ-dev-dep) och en type-only `AppRouter`-import.
- Helper-protokollet byter `downloadUrl`/`uploadUrl` mot en **document-descriptor**
  (`{ documentId, trpcUrl }`) för server-tier; demo behåller en `staticUrl`. Den
  durabla upload-kön lagrar descriptorn i st.f. en PUT-URL.
- Web-appens öppnings-flöde (`tryHelperOpen`, `fetchContentViaHelper`) slutar bygga
  REST-URL:er.

## Genomförande (en PR per steg)

1. **ADR + tRPC-klient-grund:** den här ADR:n, dep-cruiser type-only-allowance för
   helper-ui, helperns tRPC-klient-factory + deps.
2. **Läsväg (download) via tRPC:** `/open` + `/content` hämtar via
   `downloadContent` när en document-descriptor finns; statisk URL kvar för demo.
   → klick→öppna-i-native funkar self-hosted (read).
3. **Skrivväg (write-back) via tRPC:** save → `uploadContent`; durabla kön lagrar
   document-descriptorn.
4. **Städning:** ta bort REST-antagandet + `downloadUrl`/`uploadUrl`-fälten ur
   protokollet när inget längre använder dem.

## Relaterat

ADR 0013 (tunn server + tRPC-over-HTTP-add-ins; helpern följer samma mönster),
0028 (helperns egna Bearer), 0030 (ett paket). Föranlett av att helpern fick en
REST-URL som inte fanns, och önskan om tRPC + delade typer överallt.
