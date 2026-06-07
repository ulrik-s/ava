# ADR 0005 — Tunn server som git-peer: integrationer + alltid-på-jobb utan att offra local-first

- **Status:** Accepterad
- **Datum:** 2026-06-07
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** server-topologi, integrationer (Fortnox/mail), regelmotor-runtime, payment-scan, git-sync, deploy-modeller
- **Issue:** [#73](https://github.com/ulrik-s/ava/issues/73)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend), [ADR 0002](./0002-git-konflikthantering-backend-a.md) (git-konflikter), [#71](https://github.com/ulrik-s/ava/issues/71) (regelmotor-runtime), [#23](https://github.com/ulrik-s/ava/issues/23) (payment-scan), [#72](https://github.com/ulrik-s/ava/issues/72) (Outlook add-in)

## Kontext

AVA är git-first och local-first ([ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md), Backend A): browsern är runtime, all data lever som JSON i ett git-repo, synk sker via klonad working copy + push/pull. Offline-by-default är en USP.

Två behov passar dock **inte** i den rena browser-modellen:

1. **Integrationer** (bokföring mot Fortnox via Voucher API, e-post m.fl.) kräver
   - **hemligheter** (OAuth-tokens, per-byrå konto-mappning) som inte får exponeras i klient-bundeln,
   - **alltid-på** (webhooks, schemalagd sync),
   - server-sidig nätverks-åtkomst (CORS/IP-allowlist mot tredjepart).
2. **Den vilande regelmotorn** ([#71](https://github.com/ulrik-s/ava/issues/71)) och **payment-scan** ([#23](https://github.com/ulrik-s/ava/issues/23)) saknar en **runtime att ticka i** — local-first har ingen server-cron, och `DemoDataStore.onNewEvent` är en no-op. Schemalagda/bakgrundsjobb har ingen hemvist.

Frågan: hur införa en server för detta **utan** att göra servern till dataauktoritet — vilket vore Backend B (Postgres) och skulle offra local-first/offline-USP:n?

## Beslut

Inför en **tunn server som är en git-peer**, inte en dataauktoritet. Servern:

```
   Klienter (browser / mobil-webview / add-in-via-helper)
   ── lokal git-klon (OPFS/FSA), jobbar OFFLINE ──┐
                                                  │ push/pull
                                  git-remote (firma.git, byråns server)
                                                  │ pull / act / push
   ┌──────────────────────────────────────────────┘
   ▼
 Tunn server (git-peer — INTE dataägare)
   ├─ egen git-klon av firma.git
   ├─ secrets-valv (Fortnox/mail-tokens, konto-mappning)
   ├─ connector-jobb (verifikat → Fortnox Voucher API, mail-sync)
   ├─ runtime för regelmotorn (#71) + payment-scan (#23)
   └─ webhook-mottagare (Fortnox/mail)
```

1. **Git-peer:** servern håller sin egen klon av byråns git-db och deltar i samma git-synk som klienterna (pull → agera → push). Klienterna är **aldrig** beroende av servern för normalt läs/skriv — de jobbar mot sin lokala klon. Serverns frånvaro **fördröjer** bara integrationer/påminnelser (de köar tills nästa server-synk), den **bryter inte** appen.
2. **Secrets-valv:** integrations-hemligheter (Fortnox-OAuth, mail-creds) bor på servern, lämnar den aldrig. Det är därför integrationerna hör hemma serversidan.
3. **Connector-jobb:** schemalagt eller git-ändrings-drivet (servern pullar, diffar, agerar — t.ex. ny faktura → bokför verifikat mot Fortnox).
4. **Runtime för regler/jobb:** servern, som är alltid-på, tickar schemaläggaren, dispatchar events och kör payment-scannen — exakt den runtime local-first saknar.
5. **Samma backend-kod:** servern kör tRPC-routrarna bakom `IDataStore` som en **server-värd** mot en server-sidig `IDataStore` ovanpå serverns git-klon. Ingen duplicerad logik — en ny runtime-värd för samma seam (jfr ADR 0001:s pluggbara gräns; jfr även diskussionen om "en backend, flera värdar").

## Arkitektoniska invarianter

1. **Servern är ALDRIG på klientens kritiska väg.** Allt klientarbete sker mot lokal git-klon; servern är eventuellt-konsistent.
2. **Git-repot förblir enda sanningskällan.** Servern inför **ingen andra datastore** (ingen SQL) — den läser/skriver samma JSON-i-git.
3. **Hemligheter lämnar aldrig servern.** Klient-koden får aldrig Fortnox-tokens. Icke-hemlig konfig (konto-mappning) får ligga i firma.git; **tokens** i serverns valv.
4. **Server-skrivningar är additiva + idempotenta.** Servern är en git-peer som alla andra → [ADR 0002](./0002-git-konflikthantering-backend-a.md) (last-write-wins/merge) gäller dess pushar. För att minimera konflikter skriver servern helst additivt (egna event-/verifikat-rader, jfr append-only-loggen i [#58](https://github.com/ulrik-s/ava/issues/58)) och nyckar jobb idempotent mot git-state/event-id (en verifikat-push får inte dubbel-bokföra om servern kör om efter en pull).

## Konsekvenser

**Positivt**
- Local-first/offline-USP:n bevaras; servern är **tunn** (connectors + jobb + git-peer), inte en DB.
- Integrationshemligheter ligger säkert serversidan.
- Regelmotorn (#71) och payment-scan (#23) får äntligen en runtime.
- Ingen duplicerad logik — samma backend-kod, ny värd.
- Ingen ny datastore/SQL att underhålla; git förblir synk-lagret.
- Stegvis: kan börja med **en** connector (Fortnox) utan att röra klienterna.

**Negativt / risker**
- Server-pushar kan kollidera med klient-pushar → kräver robust git-konflikthantering. Mitigeras av additiva/idempotenta skrivningar + ADR 0002.
- "Alltid-på"-server = drift. Men tunn (en liten container, ingen DB) och **optionell** — bara byråer som vill ha integrationer/påminnelser kör den. 1-mans utan integrationer kör som idag, helt utan server.
- Integrationer/påminnelser blir **eventuellt-konsistenta** (sker vid nästa server-synk), inte realtid. Acceptabelt för bokföring/påminnelser.
- Servern behöver git-push-creds till repot + skyddade (HTTPS, auth) webhook-endpoints.
- Dubbel runtime-yta: backend-koden körs nu i browser **och** server → integrationstester måste täcka server-värden (samma krav som ADR 0001).

## Avgränsning mot Backend B (SQL/Postgres)

**Detta är inte Backend B.** Servern är en git-peer **ovanpå Backend A** — ingen server-authoritative SQL-store. Om/när per-entitet-ACL + skala krävs (affärsbyrå-segmentet) är Backend B (Postgres ± synk-motor som PowerSync/ElectricSQL/Zero) den separata vägen ([ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md)). De två är ortogonala: git-peer-servern kan införas **nu** utan att binda upp Backend B-beslutet.

## Fasning

1. **Server-värd** för backend-koden (`IDataStore` ovanpå server-git-klon) + en git-pull/act/push-loop.
2. **Secrets-valv** + första connectorn (Fortnox Voucher API).
3. Flytta **regelmotor-runtime** (#71) + **payment-scan-trigger** (#23) till servern.
4. **Webhooks** (Fortnox/mail) + mail-connector.

## Öppna frågor

- **Var körs servern?** Byråns egen Linux/docker (jfr self-hosted-stacken) eller en hostad tjänst? Påverkar USP:n "din data, ingen tredjepartsinfra".
- **Auth:** hur autentiserar servern mot git-remoten, och hur skyddas webhook-endpoints?
- **Konflikt-strategi i detalj** för server-pushar (en additiv event-logg räcker långt — knyter an till #58).
- **Relation till helper/Outlook-add-in** ([#72](https://github.com/ulrik-s/ava/issues/72)): är helpern en klient-peer och servern en separat peer, eller kan helpern vara en "lokal server"-variant av samma roll?
- **Secrets vs git:** konto-mappning (icke-hemlig) i firma.git, men OAuth-tokens kan **inte** ligga i git → måste delas: mappning i repo, tokens i serverns valv. Bekräfta gränsdragningen.
