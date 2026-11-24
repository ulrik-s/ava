# ADR 0039 — Timvis backup: timexport ovanpå den fulla exporten

**Status:** Antagen · **Datum:** 2026-11-24 · **Issue:** #1895 · **Intag:** ava-feedback#55
**Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md), [ADR 0023](0023-dokument-bytes-content-adresserat.md)

## Kontext

Den fulla backupen, databasen och dokumentvolymen krypterade med age, tas en
gång per natt (och när en administratör väljer "Ta backup nu", och vid
deployen). Servern är källan till sanning
([ADR 0016](0016-server-first-med-offline-first-klient.md)). Efter en
återställning synkar klienterna därför om från 0 och tar bort det som skrevs
efter backupen, också ur sin lokala cache
([runbooken, avsnitt 5b](../runbook-aterstallning.md#5b-klienterna-efter-återställningen-1360)).

Vid ett haveri kan alltså upp till ett dygns arbete gå förlorat: tidsposter,
ärenden och dokument. En förlorad tidspost är förlorat arvode, och den går
sällan att återskapa i efterhand.

Dokumentvolymen är ett git-repo där filerna skrivs en gång och aldrig raderas
([ADR 0023](0023-dokument-bytes-content-adresserat.md)). Den växer hela tiden,
så en full export varje timme blir dyr i både tid, disk och trafik till
hämtaren. Databasen är liten i jämförelse.

## Beslut

1. **Timexport.** Servern gör en timexport varje timme (kl. :15): hela
   databasen (`pg_dump`, som i dag) och de filer i dokumentvolymen som ändrats
   sedan den senaste lyckade fulla exporten startade. Samma age-nyckel som den
   fulla exporten. Namnet är `ava-<datum>-hourly.tar.age`. Filen `BASE` i
   arkivet anger den fulla export som timexporten bygger på.
2. **Den fulla exporten är oförändrad** (natten, "Ta backup nu", deployen).
   Efter en lyckad full export skrivs markören `.last-full` med exportens
   starttid. Saknas markören eller basen gör timjobbet en full export i
   stället.
3. **Timjobbet är en systemd-timer på hosten**, installerad av
   `deploy-prod.sh`. Det hoppar över medan en full export kör.
4. **Hämtaren körs varje timme.** Timexporter sparas 48 h på servern och
   72 h hos hämtaren och i spegeln. Fulla exporter sparas som i dag (14 och
   90 dagar). Hämtaren larmar om den nyaste fulla exporten är äldre än 48 h
   och om den nyaste timexporten är äldre än 3 h. Timlarmet går att välja bort
   uttryckligen.
5. **Återställningen tar den senaste exporten.** Är det en timexport:
   databasen ur dess dump, dokumenten ur basens arkiv och sedan tillägget, i
   den ordningen.
6. **"Ta backup nu" ger alltid en full export.** Timexporterna syns inte där.
7. **Återställningsövningen i CI** återställer ur en timexport.

Förlusten vid ett haveri blir då högst ungefär en timme, plus tiden tills
hämtaren har hämtat.

## Alternativ

- **Återställningskorg i klienten:** klienten behåller det som omsynken skulle
  ta bort och låter juristen lägga tillbaka det. Förkastad: klienten blir en
  andra källa till sanning, tvärtemot ADR 0016, och varje klient måste ha
  varit online med rätt data för att något ska räddas.
- **WAL-arkivering med point-in-time-återställning:** minst förlust, men ett
  nytt driftsätt för Postgres (arkivkommando, basbackuper, återspelning) som
  ska skötas och övas, och det täcker inte dokumentvolymen. Förkastad som för
  stor för behovet.
- **Full export varje timme:** enklast, men dokumentvolymen växer hela tiden
  och skulle packas, krypteras och hämtas i sin helhet 24 gånger per dygn.
  Förkastad för disk och trafik.
- **Inkrementell kedja timme för timme:** varje timexport bygger på den
  förra. Förkastad: en återställning behöver hela kedjan, och en trasig länk
  gör allt efter den oanvändbart. Med tillägget mot den fulla exporten räcker
  alltid två arkiv.
- **Schemalagt jobb i servern (pg-boss):** förkastad, eftersom containern
  medvetet saknar host-åtkomst (#1431) och inte kan läsa dokumentvolymen eller
  skriva exporterna där hämtaren hämtar dem.
- **Ingen ändring:** upp till ett dygns arbete kan fortsatt gå förlorat.
  Förkastad.

## Konsekvenser

- Mer disk på servern (upp till 48 hela databasdumpar, plus tilläggen) och hos
  hämtaren, och mer trafik till hämtaren.
- En återställning ur en timexport behöver två arkiv, basen och timexporten,
  och tillägget packas upp sist.
- Hämtarens skript uppdateras när servern börjar göra timexporter.
- Klientkoden och omsynken rörs inte. Det som skrevs efter den senaste
  timexporten tas fortfarande bort ur klienternas cache vid omsynken
  ([runbooken, avsnitt 5b](../runbook-aterstallning.md#5b-klienterna-efter-återställningen-1360)).
- Har git:s städning packat refs efter basen kan en gammal lös ref från basen
  ligga kvar efter uppackningen. Det påverkar bara git-historiken, inte
  dokumentfilerna.
- När klockan ställs tillbaka på hösten körs `*:15` två gånger med samma
  stämpel, och den andra timexporten skriver över den första. Det skadar inte
  backupen.
