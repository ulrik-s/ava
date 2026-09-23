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

## Grinden

`no-console` är **error** i `src/lib/server/**`. Att lägga till en logger utan
att stänga dörren hade bara gett en sjunde väg: nästa `console.error` hamnar i
containerloggen utan request-id, utan maskering, och utan att gå att larma på.

`observability/logger.ts` är undantaget — den *är* skrivvägen. Skript, CLI och
UI loggar till konsolen med flit och berörs inte.

## Det som INTE finns än

**Felrapportering till en mottagare** (Sentry/GlitchTip). Loggen är förutsättningen
— en felrapportör konsumerar `LogRecord` — men valet av destination är ett
drift­beslut med data­residens-konsekvenser som matchar USP:n *"din data, ingen
tredjepartsinfra"*. Self-hosted GlitchTip talar Sentrys ingest-protokoll, så en
sink kan skrivas utan att dra in `@sentry/*`. Se #1080.

**Produktanalys** (PostHog e.d.) — medvetet inte gjort. Beteendedata från en
advokatbyrå kan avslöja vem som arbetar med vad; det är en sekretessfråga, inte
en produktfråga. #1080 säger uttryckligen att det inte bör göras förrän loggning
och felrapportering finns, och sannolikt inte utan juridisk genomgång.
