# ADR 0027 — Kapabilitets-tierad klient (samma app, server-närvaro avgör funktionsuppsättning)

- **Status:** Accepterad (2026-06-20)
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** bootstrap, auth, demo, LLM/jobb, integrationer, UI-feature-gating
- **Knyter an till:** [ADR 0016](0016-server-first-med-offline-first-klient.md)
  (server-first + offline-first klient), [ADR 0025](0025-demo-som-cache-hydrerad-offline-klient.md)
  (demons cache via reconcile-vägen), [ADR 0017](0017-sync-reconcile-protokoll.md),
  [ADR 0009](0009-oidc-login-via-servern.md) (OIDC), [ADR 0024](0024-pg-boss-som-durabel-jobbko.md)
  (jobbkö/LLM), [ADR 0011](0011-pluggbar-ledger-connector.md) (ledger),
  [ADR 0023](0023-dokument-bytes-content-adresserat.md) (dokument-bytes).

## Kontext

ADR 0016 gjorde web-klienten offline-first över `CachingSyncDataStore`; ADR 0025
enade demons cache-hydrering på den **riktiga** reconcile/pull-vägen
(`StaticSyncSource`-loopback). Båda handlar om **datavägen** — och de har gjort
demon och self-hosted till *samma* datalager-kod, bara med olika injicerad
`SyncTransport`.

Men en växande mängd funktioner kräver en **server**: OIDC-login (ADR 0009),
LLM-dokumentklassificering via durabel jobbkö (ADR 0024), ledger-connector
(ADR 0011), e-post-/kalender-spegling, server-side byte-lagring. I demon (GH
Pages, ingen server) finns de inte. Idag riskerar de hanteras med spridda
`if (demo)`-villkor — vilket är exakt den klass av divergens som gav
"(kontakt saknas)" (#633): demo-vägen och server-vägen drev isär eftersom de
grenade på *läge* i stället för på *kapabilitet*.

Vi vill: **EN app.**
- **GH-demon** = klienten *utan* server: cache-seedad (ADR 0025), fejkad login,
  server-funktioner dolda — men allt som *kan* köras lokalt fungerar fullt ut.
- **Lokalt / self-hosted** = *samma* klient *med* server → alla server-funktioner
  tända (riktig OIDC, LLM, sync, integrationer).

…utan att special-casa "demo" någonstans i feature-koden.

## Beslut

**Funktionsuppsättningen är en kapabilitets-tier som väljs vid bootstrap — inte
en kod-fork.** Varje server-beroende funktion uttrycks som en injicerad **port**
plus en **kapabilitets-flagga**. UI:t och flödena gate:ar på `capabilities.X`,
**aldrig** på `if (isDemo)`.

### 1. Server-närvaro avgörs via **probe** (vald)

Vid start probar klienten serverns kapabilitets-endpoint (t.ex. en
`system.capabilities`-query / health-check, samma origin bakom oauth2-proxy):

- **Svar** → server-mode, med de kapabiliteter **servern annonserar**. Servern
  äger sanningen: en self-hosted byrå *utan* ollama annonserar `llm: false`, en
  utan ledger-connector annonserar `ledger: false` — så de döljs *lika
  konsekvent* som i demon. Klienten hårdkodar inte "server ⇒ allt".
- **Inget svar** (timeout/404/offline) → **demo-mode**: `StaticSyncSource`
  (ADR 0025) + demo-principal, kapabiliteter = demo-baslinjen.

Probe framför ren config: din lokala stack "bara funkar", GH Pages saknar
naturligt en server, och en server som tappar en kapabilitet (ollama nere)
reflekteras direkt. Kostar ett boot-steg + timeout/fallback (se Konsekvenser).

### 2. Saknad kapabilitet ⇒ affordansen **döljs** (vald)

Server-only-funktioner som saknas i nuvarande tier **renderas inte** — ingen
gråad knapp, ingen klient-stub som låtsas. Däremot visas **redan seedat
tillstånd** oförändrat: ett dokuments befintliga etiketter/analys (förbakade i
demo-seeden) syns, men *handlingen* "Analysera med LLM" / "Kör om" döljs. Skiljer
**data** (finns alltid) från **förmåga** (kräver server).

### Kapabilitets-matris

| Förmåga | Demo (ingen server) | Self-hosted (server) | Söm |
|---|---|---|---|
| Läs/skriv lokalt | ✓ (cache är sanningen) | ✓ | `CachingSyncDataStore` |
| Sync mot server | — `noSyncTransport`/`StaticSyncSource` | ✓ `TrpcSyncTransport` | `SyncTransport` (ADR 0017) |
| Login / principal | demo-provider — "logga in som &lt;användare&gt;"-växlare | OIDC (oauth2-proxy/KC) | principal-källa |
| LLM-klassificering / etikett-förslag | **dold** (seedad analys visas) | ✓ ollama-jobb | tag-suggester-port + jobbkö (ADR 0024) |
| Durabla jobb | **dold** | ✓ pg-boss | jobbkö |
| Ledger / Fortnox | **dold** | ✓ om konfigurerad | connector (ADR 0011) |
| E-post-/kalender-spegling | **dold** | ✓ om konfigurerad | integrations-port |
| Helper-app (lokal fil) | ✓ (degraderar om ej installerad) | ✓ | helper-klient |
| Äkta multi-user/real-tid | — (en cache; "logga in som" simulerar) | ✓ | — |

### Login är den enda *inneboende* skillnaden

Allt annat är dolt-eller-tänt; login skiljer sig i *natur*. Sömmen är en
**principal-källa**: demo injicerar en identitet utan nätverk, server härleder
den via OIDC. Detta pensionerar samtidigt den legacy GitHub-eran-hook
`useAuthMode` (källan till "@okänd"-bannern): banner-texten blir "vilken
principal + vilka kapabiliteter", ärligt i båda lägena.

**Demo-identitet = "logga in som &lt;användare&gt;"-växlare (beslut).** Demon
exponerar en användarväljare över de seedade användarna (Anna/Björn/…) i st.f.
en enda fast principal. Det säljer in produkten (varje jurist ser *sin* dashboard/
tid/todo, precis som #635 byggde) och övar principal-scoping på riktigt — samma
kod-väg som OIDC-bunden principal i server-läge, bara en annan källa.

### Persistens i demon (beslut)

**Redigeringar persisteras över omladdning + en "Återställ demo"-knapp.** Demons
cache (IndexedDB/OPFS, ADR 0025) behålls mellan besök så ändringar överlever
reload — som den riktiga klienten. "Återställ demo" rensar cachen → re-hydreras
från den bundlade seeden via reconcile-vägen (ADR 0025). Version-bump
(`NEXT_PUBLIC_DEMO_VERSION`) återställer automatiskt vid redeploy.

## Konsekvenser

- **Parity by construction.** Demo och server kör identisk feature-kod över samma
  store; skillnaden är *injicerade portar + en kapabilitets-flagga*. Divergens-
  buggar (typ "(kontakt saknas)") förebyggs strukturellt, inte med disciplin.
- **`if (capability)` blir en regel** som kan tvingas med lint/dep-cruiser senare;
  `if (isDemo)` i feature-kod blir en lukt att förbjuda.
- **Kallstart-UX:** probe = ett boot-steg med timeout → demo-fallback. Måste vara
  snabb och fail-safe (aldrig blockera appen "AVA Laddar…", jfr #628).
- **Demon visar inte allt produkten kan** (dolda förmågor). Acceptabelt; ev. en
  diskret "kräver server"-upplysning intill dolda ytor om vi vill sälja in dem.
- **Server-annonserade kapabiliteter** ger en bonus: degradering är samma
  mekanism för "demo" och "self-hosted utan ollama/ledger" — en kodväg.
- **Multi-user/real-tid** kan demon inte bevisa äkta (en cache/browser);
  "logga in som"-växlaren simulerar per-användar-scoping men inte cross-klient-sync.

## Genomförande (en PR per steg)

1. **Kapabilitets-deskriptor + probe + bootstrap-väljare** (denna ADR + tester).
   Ingen UI-ändring — väljer bara portar/flaggor; server annonserar `capabilities`.
2. **Principal-källa-söm:** demo-provider + OIDC-källa; pensionera `useAuthMode`/
   "@okänd"-bannern → kapabilitets-/principal-medveten banner.
3. **Gate server-only-affordanser** (LLM "Analysera", integrationer, jobb-UI) på
   `capabilities` → dolda i demo.
4. **Blob-cache i demon** (knyter an ADR 0025 steg 3 / ADR 0023): seeda
   dokument-bytes i OPFS så dokumentladdning är cache-lokal (inga GH-träffar).

## Beslutade detaljer

- **Demo-identitet:** "logga in som &lt;användare&gt;"-växlare (se ovan).
- **Persistens i demon:** persist över omladdning + "Återställ demo"-knapp (se ovan).

## Relaterat

ADR 0016, 0025, 0017, 0009, 0024, 0011, 0023, 0018. Förebygger samma divergens
som #633 (prebake-on-sync) och #635 (login-ägd data) adresserade i efterhand.
