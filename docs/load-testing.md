# Lasttest mot server-first (#1366)

Mål: **20 samtidiga användare, med marginal till 50**, mot samma stack som i
drift — server-first-binären i docker, Postgres 16 och pg-boss — och genom
**samma klientkod som webbläsaren**. Lasttestet är inte ett PR-krav; det körs
nattligt och manuellt (workflow:et *Lasttest*) och lokalt med:

```bash
bun run load:test          # 20 användare i 2 byråer, ~3–5 min
bun run load:test:50       # 50 användare i 3 byråer
LOAD_SOAK=1 bun run load:test            # vanligt arbete i 30 minuter
LOAD_SCENARIOS=invoice bun run load:test # ett enskilt scenario
```

Skriptet (`tooling/load/load-test.sh`) bygger binären, startar
`tooling/docker/docker-compose.load.yml` under ett eget compose-projekt och
egna portar (`LOAD_COMPOSE_PROJECT`, `LOAD_PG_PORT`, `LOAD_PORT_BASE`), skapar
en databas per byrå, migrerar, kör `tooling/load/run.ts` och river stacken
(`LOAD_KEEP=1` låter den stå kvar). Exit 0 = alla krav uppfyllda, 1 = krav
bröts, 2 = avbrott. Rapporten hamnar i `reports/load/`: `load-report.json`,
`load-report.txt` och `containers.log`.

## Hur en virtuell användare är byggd

Varje användare är en egen klient i bun-processen (`tooling/load/virtual-user.ts`):

- `createServerFirstStore` — lokal store, procedurkö och reconcile-motor —
  mot servern över HTTP (`TrpcSyncTransport`), med lagring i minnet i stället
  för IndexedDB (som synksimuleringen, #1268);
- routrarna körs i klienten (`GitBackendRuntime` + `recordProcedure`), så en
  tidspost skapas lokalt och köas som anrop, precis som i appen;
- `SyncScheduler` synkar strax efter varje ändring och var `LOAD_POLL_MS`, och
  enhetsrapporten (`sync.reportDevice`) skickas efter varje synk;
- sök, nedladdning och uppladdning går direkt mot servern, uppladdningen via
  byte-synken (`runContentSync`).

Identiteten är proxyns header (`X-Auth-Request-Email`, `AVA_IDENTITY=forwarded`)
— samma testläge som *Server-first (deploy E2E)*. Caddy och oauth2-proxy är
inte med; servern exponeras direkt. Varje byrå har en egen server-first-container
(servern är single-org, ADR 0016) och en egen databas i samma Postgres. CPU och
minne begränsas per container (`LOAD_SERVER_CPUS`/`_MEM`, `LOAD_PG_CPUS`/`_MEM`,
default 2 CPU / 2 GB).

Allt mäts på HTTP-nivå: varje anrop tidtas med hela svarskroppen, och felen
räknas per anrop även inne i en batch (tRPC svarar 207 när bara en del fallerar).

## Scenarierna

| # | Scenario | Vad som händer |
|---|---|---|
| 1 | `work` | Alla registrerar tid, utlägg och anteckningar, ändrar tid, öppnar ärenden, lägger upp kontakter, söker och hämtar dokument — med exponentialfördelad väntan kring `LOAD_THINK_MS` (3 s). `LOAD_DURATION_S` (60) eller `LOAD_SOAK=1` (30 min). |
| 2 | `storm` | Alla går offline, köar `LOAD_OFFLINE_MIN`–`LOAD_OFFLINE_MAX` (50–200) ändringar var och kommer tillbaka samtidigt. |
| 3 | `invoice` | Alla köar aconto-fakturor (`LOAD_INVOICES_PER_USER`) och kostnadsräkningar (`LOAD_KR_PER_USER`) offline och kommer tillbaka samtidigt — omkörningarna slåss om nummerserierna. |
| 4 | `documents` | Samtidiga uppladdningar (`LOAD_UPLOADS_PER_USER` × `LOAD_UPLOAD_KB`) och klassificeringsjobben de startar. Med `AVA_LLM_ENDPOINT`/`AVA_LLM_MODEL` körs ollama-profilen också. |
| 5 | `idempotency` | Samma köposter (procedurkö och radkö) skickas samtidigt från `LOAD_TABS` (4) flikar — servern ska tillämpa var och en exakt en gång. |

Efter scenarierna synkar alla tills köerna är tomma, och varje klients lokala
läge jämförs med serverns (tidsposter, utlägg, kontakter, fakturor, ärenden,
anteckningar). En **ny** klient per byrå synkar också från början och jämförs:
konvergerar den men inte de långlivade, har de senare missat ändringar på vägen.

## Kraven

| Krav | Default | Variabel |
|---|---|---|
| p95 för push/pull och vanliga anrop i scenario 1 | < 500 ms | `LOAD_MAX_P95_MS`, `LOAD_P95_OPS` |
| HTTP 5xx | 0 | `LOAD_MAX_5XX` |
| Stormens köer tomma | 120 s vid ≤ 20 användare, annars 300 s | `LOAD_MAX_DRAIN_S` |
| Ingen mutation förlorad eller dubblerad, inga avvisningar | — | — |
| Fakturanummer och KR-referenser: inga dubbletter, inga luckor | — | — |
| Klienterna konvergerar mot servern | — | — |
| Postgres: under `max_connections`, låsväntan, deadlocks | 1 000 ms, 0 | `LOAD_MAX_LOCK_WAIT_MS`, `LOAD_MAX_DEADLOCKS` |
| Klassificeringskön tömd | 120 s | `LOAD_MAX_JOB_DRAIN_S` |
| Serverns minne | bara rapporterat | `LOAD_MAX_SERVER_MEM_MIB` |

Låsväntan mäts två vägar: sampling av `pg_stat_activity` var 250:e ms, och
Postgres egen logg (`log_lock_waits=on`, `deadlock_timeout=1s`), som fångar
varje väntan över en sekund. Deadlocks räknas ur `pg_stat_database`. CPU och
minne per container kommer från `docker stats`. Lastgeneratorns egen event
loop-fördröjning rapporteras också — är den hög har klientprocessen, inte
servern, blivit flaskhalsen.

## Resultat 2026-10-01 (lokalt, Apple M-serie, Docker Desktop 10 CPU / 16 GB)

Första körningen. Stacken på en utvecklarmaskin, inte en VPS — tiderna är
en undre gräns för vad en VPS av prod-storlek klarar, men felen är inte
maskinberoende.

| | 20 användare / 2 byråer | 50 användare / 3 byråer |
|---|---|---|
| p95 vanligt arbete: pull / push / replay / sök / hämta | 52 / 15 / 38 / 53 / 23 ms ✓ | 145 / 48 / 79 / 62 / 44 ms ✓ |
| Storm: köade ändringar, alla köer tomma | 2 761, **11,5 s** ✓ (gräns 120 s) | 6 641, **20,9 s** ✓ (gräns 300 s) |
| Storm: förlorade / dubblerade / avvisade | 0 / 0 / 0 ✓ | 0 / 0 / 0 ✓ |
| Fakturanummer (F-ÅÅÅÅ-NNNN) | obrutna, unika ✓ | obrutna, unika ✓ |
| KR-referenser | **dubbletter** ✗ #1379 | **dubbletter** ✗ #1379 |
| Uppladdningar med HTTP 500 | **30 av 60** ✗ #1378 | **76 av 150** ✗ #1378 |
| Klassificeringskön tömd | 28,7 s ✓ | 51,5 s ✓ |
| Samma post från 4 flikar: procedurkön | en gång, alla `accepted` ✓ | en gång, alla `accepted` ✓ |
| Samma post från 4 flikar: radkön | **20 av 40 svar 500** ✗ #1380 | **27 av 60 svar 500** ✗ #1380 |
| Konvergens: långlivade / ny klient | **7** / 0 avvikelser ✗ #1381 | **22** / 0 avvikelser ✗ #1381 |
| Postgres: anslutningar, låsväntan, deadlocks | 29/100, max 212 ms, 0 ✓ | 44/100, max 177 ms, 0 ✓ |
| Server: CPU snitt/max, minne max | 24 % / 124 %, 152 MiB | 28 % / 121 %, 210 MiB |
| Postgres: CPU snitt/max, minne max | 25 % / 149 %, 148 MiB | 48 % / 202 %, 210 MiB |
| `sync.pull` på servern, p99 / max | 2,1 / 2,3 s | 8,2 / 8,6 s — #1388 |

(CPU i procent av en kärna, så 120 % = 1,2 kärnor.)

Slutsats: kapaciteten räcker med marginal — vanligt arbete ligger långt under
gränserna även vid 50, och stormen töms på en bråkdel av tiden. Felen är
samtidighetsfel som syns redan med få användare: KR-serien saknar lås (#1379),
content-storens skrivningar krockar på indexlåset (#1378), radkönens create är
inte idempotent vid samtidighet (#1380), och delta-pullens cursor hoppar förbi
rader som committas i fel ordning (#1381). Pullen är den enda operation som
blir långsam under last (#1388).

**Begränsning:** alla virtuella användare delar en bun-process. Vid 50
användare blockeras dess event loop i sekunder när alla samtidigt pullar
tusentals rader efter stormen (rapportens rad "Lastgeneratorns event loop") —
klientens svarstider i storm- och faktureringsfaserna är därför för höga vid
50. Serverns egen tid per procedur (ur loggen) påverkas inte och är den som
ska jämföras där.
