# ADR 0001 — Pluggbar backend bakom `IDataStore`/tRPC: Git (local-first) ⟷ Postgres (server)

- **Status:** Accepterad (senare reviderad av [ADR 0016](0016-server-first-med-offline-first-klient.md) 2026-06-16 — dual-backend-modellen ersatt av server-first (Postgres + tRPC) med offline-first klient; git-vägen (Backend A) pensioneras **stegvis** via #420/#421).
- **Datum:** 2026-05-27
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** datalager, tRPC-routrar, deploy-modeller, framtida ACL

## Kontext

AVA ska tjäna två väldigt olika kundtyper med **samma kodbas**:

- **Demo + 1-mansbyråer + humanjuridiska byråer** — vill ha en enkel, robust,
  drift­fri lösning. Inget ACL-behov (en användare, eller en byrå där alla ser
  allt). Måste kunna köra helt på GitHub Pages (eller motsvarande statisk
  hosting) och fungera **offline**.
- **Affärsjuridiska byråer** — har konfidentialitets-/ACL-krav (advokat­sekretess,
  jävskontroll, per-ärende-åtkomst) och större datavolymer. Här är en riktig
  server med databas acceptabelt och önskvärt.

Idag kör hela "backend" (tRPC-routrar + `DemoDataStore`) **in-process i
browsern**, mot ett git-repo som klonas till OPFS och synkas via
isomorphic-git. Det ger offline + tunn server, men:

- Per-entitet-behörighet går inte att enforce:a (klienten har hela repot).
- En in-memory query-motor med linjära scans skalar inte med datavolym.

Vi vill inte tvinga den enkla kunden in i server-komplexitet, och inte heller
låsa oss från en server-backend när en affärsbyrå kräver det. **Nyckeln är att
gränsen mellan webapp och backend är skarp och stabil**, så att backend kan
bytas utan att röra UI eller affärslogik.

## Beslut

Vi etablerar **`IDataStore` + tRPC-routrarna som den hårda, stabila gränsen**,
och stöder **två ömsesidigt uteslutande backend-implementationer** bakom den.
Vald per deploy — aldrig båda samtidigt.

```
            ┌──────────────────────────────────────────────┐
            │  UI (Next.js)  →  tRPC-routrar (affärslogik)  │   ← oförändrat oavsett backend
            └───────────────────────┬──────────────────────┘
                                     │  ctx.dataStore : IDataStore   (DEN STABILA GRÄNSEN)
                                     │  ctx.user      : Principal
          ┌──────────────────────────┴───────────────────────┐
          ▼                                                    ▼
┌───────────────────────────┐               ┌──────────────────────────────┐
│ Backend A — GIT            │               │ Backend B — POSTGRES          │
│ (local-first)              │               │ (server-authoritative)        │
│                            │               │                               │
│ • Lagring: server + klient │               │ • Lagring: server             │
│ • Exekverar: i KLIENTEN    │               │ • Exekverar: på SERVERN       │
│ • tRPC: in-process link    │               │ • tRPC: HTTP link             │
│ • OFFLINE: ja              │               │ • OFFLINE: nej                │
│ • ACL: nej (firma-nivå)    │               │ • ACL: ja (per-entitet)       │
│ • Skala: liten/medel       │               │ • Skala: stor                 │
│ → demo, 1-mans, humanjur.  │               │ → affärsbyråer                │
└───────────────────────────┘               └──────────────────────────────┘
```

**Git och Postgres samexisterar INTE i samma deploy.** Git är inte en
audit-/export-spegel bakom Postgres — de är två separata backend-system. När en
kund kör Postgres försvinner git ur den deployen helt.

### De två backendarna

| | **Backend A — Git (local-first)** | **Backend B — Postgres (server)** |
|---|---|---|
| Lagring | Server (bare repo) **och** klient (OPFS working copy) | Endast server |
| Exekvering | I browsern (in-process tRPC) | På servern (HTTP tRPC) |
| Offline | Ja — mutationer skrivs lokalt, synkas vid uppkoppling | Nej — kräver uppkoppling |
| Konflikthantering | git-merge (måste vara begriplig för användaren) | DB-transaktioner |
| ACL / sekretess | Nej — endast firma-nivå-isolering (repo = gräns) | Ja — server auktoriserar per request |
| Principal (`ctx.user`) | Självdeklarerad (OK — ingen ACL att skydda) | Server-verifierad |
| Skala | Liten–medel (allt i minnet) | Stor (indexerade queries, pagination) |
| Hosting | GitHub Pages / statisk + tunn git-server | App-server + Postgres |
| Målgrupp | Demo, 1-mans, humanjuridiska byråer | Affärsjuridiska byråer |

## Arkitektonisk regel (gränskontraktet)

För att backend ska förbli utbytbart gäller, **från och med nu** (även under
acceptansfasen):

1. **Routrar och UI får ALDRIG gå runt `ctx.dataStore`.** Ingen router/UI-kod
   importerar git, OPFS, isomorphic-git eller `pg`/Prisma direkt. All
   persistens går genom `IDataStore`.
2. **Routrarna är backend-agnostiska.** De beror bara på `ctx.dataStore` och
   `ctx.user` — aldrig på huruvida vi kör offline/online eller git/PG.
3. **Online/offline-skillnaden hanteras vid eller bakom gränsen** (transport-
   länk + store-impl), inte i affärslogiken.
4. **`ctx.user` är en principal-abstraktion.** Backend A får självdeklarera den
   (ingen ACL att skydda). Backend B måste server-verifiera den. Routrarna ska
   redan idag uttrycka behörighet via `ctx` (t.ex. `orgProcedure`) så att Fas 2
   kan göra den verklig utan router-omskrivning.
5. **Två transport-länkar, samma router-yta:** in-process (`demo-trpc-link`)
   för Backend A, HTTP-tRPC för Backend B. Båda hålls i synk i form.

## Konsekvenser

**Positivt**
- Den enkla kunden får aldrig server-drift; affärskunden får skala + ACL — utan
  två kodbaser.
- `IDataStore` är redan en ren, Prisma-formad seam (en `PostgresStore` har
  funnits förut och togs bort), så Backend B är ett återinförande, inte en
  nyuppfinning.
- ACL/sekretess kan adderas senare **utan** att röra UI eller router-signaturer
  — bara i `ctx.user` + policy + Backend B.

**Negativt / risker**
- Två exekveringsmodeller (klient vs server) måste hållas i synk; integrations-
  testerna måste täcka båda transport-länkarna.
- Backend A kan per definition **inte** ge per-entitet-sekretess. Det måste
  kommuniceras tydligt: affärsbyråer med ACL-krav → Backend B.
- Frestelsen att smyga in en klient-sidig genväg (läsa git/OPFS direkt) för att
  "spara ett anrop" skulle bryta kontraktet. Måste fångas i review/lint.

## Fasning — vad som gäller nu (acceptansfasen)

1. **Nu:** robusthet i **Backend A**. Viktigast: git-konflikter får inte synas
   som obegripliga merge-konflikter för användaren. Sekretess/ACL skjuts upp.
2. **Löpande:** efterlev gränskontraktet ovan i all ny kod, så Backend B förblir
   möjlig utan omskrivning.
3. **Senare (vid första affärskund):** server-verifierad principal + policy
   (per-ärende-ACL) → återinför `PostgresStore implements IDataStore` + HTTP-tRPC
   som en deploy-profil.
4. **Ej nu:** Rust-omskrivning av query-motorn. Skalning löses av Backend B
   (indexerade queries), inte av att göra de linjära scanningarna snabbare.
   Rust/WASM omvärderas bara för klient-sidiga hotspots (sök-index, krypto).

## Öppna frågor

- Exakt UX för git-konflikt­hantering i Backend A (sista-skrivning-vinner vs
  fält-merge vs användar-prompt) — eget beslut/ADR.
- Hur en kund migrerar A → B (engångs-import av git-JSON till Postgres).
- Principal-/auth-mekanism för Backend B (egen tunn tjänst vs befintlig
  IdP) — knyter an till `docs/auth.md` och USP:n "din data, du bestämmer".
