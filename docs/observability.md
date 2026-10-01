# Observability — strukturerad loggning

Hur man tar reda på vad som hände, utan att bryta sekretessen. Bakgrund: [#1080](https://github.com/ulrik-s/ava/issues/1080).

## Varför det här inte är en vanlig logg

En vanlig applikation loggar gärna indata för att kunna felsöka. Här är indatat
klientens personnummer, motpartens namn och vad tvisten gäller. **Advokat­sekretessen
gäller uppgiften om att någon *är* klient** — inte bara vad klienten sagt. En logg
som avslöjar att `19670312-4521` finns i systemet har redan läckt det.

Loggningen är därför byggd runt en enda regel: **det som inte skickas kan inte läcka.**

## Två lager, i den ordningen

**1. Strukturen.** En `LogRecord` bär bara deklarerade fält. Det finns ingen
`meta: unknown` att hälla en tRPC-input i — inte av disciplin, utan för att typen
inte tillåter det. Samma princip som fältprojektionen på MCP-ytan (#1014): en
tillåtlista gör läckan omöjlig i stället för osannolik.

| Fält | Innehåll |
|---|---|
| `ts` `level` `event` | alltid satta; `event` är maskinläsbar (`trpc.query`, `job.failed`) |
| `requestId` | korrelations-id — se nedan |
| `userId` `orgId` | **ids, aldrig namn eller e-post.** Ett id går att slå upp av den som har rätt |
| `path` `durationMs` `outcome` `code` | tRPC-procedurens namn, tid, utfall, felkod |
| `message` | maskerat felmeddelande |

**2. Maskeringen** (`observability/redact.ts`) — för texten som ändå måste med,
framför allt felmeddelanden. En domänregel kan mycket väl kasta
*"Klienten Anna Andersson (19670312-4521) saknar fullmakt"*.

Maskeras: personnummer, samordningsnummer och organisationsnummer (med eller utan
separator), e-post, telefonnummer, Bearer-token och lång hex (refresh-token-formen).

Maskeringen är **avsiktligt trubbig**. Den kan inte känna igen ett namn och påstår
inte att den kan. Att lita på lager 2 i stället för lager 1 är fel väg runt.

## Korrelations-id

Det här är fältet som gör en användarrapport sökbar.

```
Användaren: "det small vid tiotiden"     → inget att gå på
Användaren: "det stod K7M2PQX4RTBN"      → alla poster för just det anropet
```

Tolv tecken ur ett alfabet **utan `0/O` och `1/I/L`** — de förväxlas när någon
läser upp id:t i telefon, och det är precis då det används.

Klienten får skicka sitt eget via `x-ava-request-id`, men bara om det har vår
form. Annars kan vem som helst krocka med en annan användares id, eller smuggla
in tecken som bryter loggraden som JSON.

## I drift

```bash
AVA_LOG_LEVEL=info bun src/bin/server-first.ts    # default: bara fel
AVA_LOG_LEVEL=debug ...                            # + en rad per tRPC-anrop
```

JSON per rad till **stderr** — inte stdout, som är nyttolast för CLI:t och
MCP-servern över stdio. En loggrad där korrumperar protokollet.

```bash
# alla fel senaste timmen
docker logs ava-server 2>&1 | jq -c 'select(.level == "error")'

# spåra en användarrapport
docker logs ava-server 2>&1 | jq -c 'select(.requestId == "K7M2PQX4RTBN")'

# långsammaste anropen
docker logs ava-server 2>&1 | jq -c 'select(.durationMs > 1000) | {path, durationMs}'
```

### Integritetskontrollen: metadata utan innehåll (#1145)

Med ett innehållslager (`AVA_CONTENT_DIR`) kontrollerar servern vid start och
sedan dagligen att varje dokument har sitt innehåll
(`src/lib/server/integrity/content-integrity.ts`). Dokument yngre än 15
minuter räknas inte, eftersom klienten laddar upp bytes:en efter raden.

| Händelse | Nivå | Fält |
|---|---|---|
| `content.integrity.missing` | error | `count` (dokument utan innehåll), `total` (kontrollerade), `ids` (dokument-id:n) |
| `content.integrity.ok` | info | `total`, `count: 0` |

```bash
# larma på dokument utan innehåll
docker logs ava-server 2>&1 | jq -c 'select(.event == "content.integrity.missing") | {count, ids}'
```

## Felrapportering till PostHog EU (#1343)

Loggen ovan stannar på byråns server. En felrapport **lämnar** processen, och
därför gäller strängare regler än för loggen:

- **Av som standard.** Utan `AVA_POSTHOG_KEY` skickas ingenting — loggen till
  stderr fungerar precis som förut.
- **EU-regionen.** Mottagaren är PostHog EU Cloud (Frankfurt, AWS
  eu-central-1): standardvärden är `https://eu.i.posthog.com`. En amerikansk
  PostHog-värd (`us.i.posthog.com`, `us.posthog.com`) **vägras**, även som
  uttryckligt val. `AVA_POSTHOG_HOST` finns bara för själv-hostad PostHog.
- **Personuppgiftsbiträde.** PostHog är ett amerikanskt bolag som behandlar
  data åt byrån. Teckna PostHogs biträdesavtal (DPA) innan nyckeln sätts.
  Dataminimeringen nedan gör att rapporterna inte innehåller klientuppgifter.
- **Bara serverfel.** Ett `TRPCError` med 4xx-status (`BAD_REQUEST`,
  `FORBIDDEN`, `NOT_FOUND`, valideringsfel …) är ett förväntat utfall och
  skickas **aldrig**. Bara 5xx och fel som inte är `TRPCError` alls.
- **Dataminimering.** Rapporten byggs av en tillåtlista, inte genom att
  maska bort det farliga. Händelsen är `$exception` med konstant
  `distinct_id` (`ava-server`), utan personprofil (`$process_person_profile:
  false`) och utan geoIP (`$geoip_disable: true`).

| Skickas | Exempel |
|---|---|
| felets klass | `TypeError`, `PostgresError` |
| maskinläsbar felkod om felet har en (bara `A–Z0–9_`) | `23505`, `ECONNREFUSED` |
| tRPC-procedurens path (`procedure`) | `invoice.create` |
| `request_id` | `K7M2Q9XRT4PB` |
| server-version och miljö | `AVA_RELEASE`, `AVA_ERROR_ENVIRONMENT` |
| tidpunkt | ISO-8601 |
| stack trace: fil (projektrelativ), rad, kolumn, funktionsnamn | `src/lib/server/routers/x.ts:42` |

| Skickas ALDRIG | |
|---|---|
| felmeddelandet (`message`) — inte ens maskerat | domänregler formulerar sig med klientens namn |
| användar-id, org-id, e-post, namn | |
| tRPC-input, request-kroppar, URL:er, headers | |
| värdnamn, IP, brödsmulor, miljövariabler | |
| session replay, autocapture, klientsidans händelser | finns inte i AVA |

Meddelandet tas bort ur stacken innan ramarna tolkas, och bara rader som exakt
har formen `at funktion (fil:rad:kolumn)` blir ramar — ett meddelande som ser ut
som en ram kan inte smyga med. Implementationen är en ren `fetch` utan SDK mot
PostHogs capture-API (`POST {värd}/i/v0/e/`):
`src/lib/server/observability/error-reporter.ts` (vad som får skickas),
`stack-frames.ts` (ramarna) och `posthog-sink.ts` (protokollet).

**Aldrig i vägen.** Sändningen väntas inte in, har 5 s timeout och högst fyra
samtidiga sändningar (fler kastas, så en felstorm inte blir en minnesläcka). Ett
`429` pausar sändningen i `Retry-After` sekunder (default 60). Ett fel mot
mottagaren sväljs — det loggas inte, eftersom det skulle kunna loopa.

| Variabel | Default | |
|---|---|---|
| `AVA_POSTHOG_KEY` | tomt = **av** | projektets token (`phc_…`), skapas på eu.posthog.com |
| `AVA_POSTHOG_HOST` | `https://eu.i.posthog.com` | bara för själv-hostad PostHog; amerikansk värd vägras |
| `AVA_ERROR_ENVIRONMENT` | `production` | t.ex. `staging` (bara `A–Z a–z 0–9 . _ + -`) |
| `AVA_RELEASE` | — | server-versionen, t.ex. commit-sha |

En felaktig nyckel eller värd gör inte servern otillgänglig, men den syns i
startloggen: `felrapportering: AV — …`. En fungerande ger
`felrapportering: PostHog eu.i.posthog.com (<miljö>)` — nyckeln skrivs aldrig ut.

### Byta region

Ett befintligt PostHog-projekt kan inte byta region. Skapa i stället ett konto
och ett projekt på **eu.posthog.com** och använd det projektets token.

## Grinden

`no-console` är **error** i `src/lib/server/**`. Att lägga till en logger utan
att stänga dörren hade bara gett en sjunde väg: nästa `console.error` hamnar i
containerloggen utan request-id, utan maskering, och utan att gå att larma på.

`observability/logger.ts` är undantaget — den *är* skrivvägen. Skript, CLI och
UI loggar till konsolen med flit och berörs inte.

## Det som INTE finns än

**Fel från webbläsaren och bakgrundsjobben.** Felrapporteringen ovan täcker
serverns tRPC-anrop; klientens fel (React, synkmotorn i fliken) och
bakgrundsjobbens fel rapporteras inte än — de syns i loggen.

**Produktanalys** — medvetet inte gjort. Beteendedata från en
advokatbyrå kan avslöja vem som arbetar med vad; det är en sekretessfråga, inte
en produktfråga. #1080 säger uttryckligen att det inte bör göras förrän loggning
och felrapportering finns, och sannolikt inte utan juridisk genomgång.
