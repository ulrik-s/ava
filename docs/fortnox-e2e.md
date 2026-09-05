# Fortnox-E2E — köra mot riktiga Voucher API

Enhetstesterna för connectorn kör med injicerad `fetch` och bevisar att VÅR kod
är konsekvent. De kan inte upptäcka att Fortnox ändrat sig. Det här flödet går
hela vägen: OAuth-refresh → semantiskt verifikat → `POST /3/vouchers` → läs
tillbaka verifikatet → kontrollera balans och idempotens.

Kör automatiskt på **push till `main`** (när Fortnox-/ledger-koden ändrats) och
**nattligt 04:17 UTC**. Manuellt: **Actions → “Fortnox E2E” → Run workflow**.
Lokalt: `bun run fortnox:e2e` med env satt (se nedan).

## Var verifikaten hamnar — och hur de städas bort

Det här är förutsättningen för att flödet alls får köra automatiskt, så det är
värt att ha rätt. **Fortnox API kan inte ta bort ett verifikat** — det har varken
`DELETE` eller `PUT` för `/3/vouchers`. Men kontot kan:

- **I GUI:t går det alltid att ta bort det *sista* verifikatet i varje serie.**
  Ska ett verifikat mitt i serien bort måste alla med högre nummer i samma serie
  tas bort först.
- **Ett räkenskapsår kan raderas i sin helhet** av en programadministratör för
  Bokföring — förutsatt att det bara innehåller *manuella* verifikat, alltså inga
  kund-/leverantörsfakturor, banktransaktioner eller anläggningsposter.

Därför bokför CI i sin **egen verifikatserie** och sitt **egna räkenskapsår**.
Villkoret för årsraderingen är uppfyllt av konstruktion: connectorn skapar bara
manuella verifikat via `POST /3/vouchers`.

### Tömma bokföringen

| Vill du … | Gör så |
|---|---|
| ta bort de senaste körningarnas skräp | Bokföring → verifikationer, filtrera på CI-serien, ta bort **bakifrån** |
| börja om från noll | radera hela CI-räkenskapsåret (Inställningar → Räkenskapsår) och lägg upp det på nytt |

Byråns skarpa serier och år rörs inte i något av fallen.

### Spärren som håller det sant

`AVA_FORTNOX_BOOKING_WINDOW` (`"YYYY-MM-DD..YYYY-MM-DD"`) anger CI:s
räkenskapsår. E2E-skripten daterar om verifikaten till ett datum inne i fönstret
och lindar connectorn i `withBookingWindow`, som **avvisar allt daterat utanför
fönstret innan det når nätet**. Saknas variabeln kastar skriptet — spärren ska
inte gå att komma runt genom att glömma en env-variabel.

En felkonfad körning (fel tenant, fel datum, fel serie) kan alltså inte skriva i
den skarpa perioden.

## Varför inte på PR-commits

Två skäl, båda oberoende av städbarheten:

1. **Secrets når inte fork-PR:er.** Varje extern PR hade blivit röd på något
   bidragsgivaren inte rår över.
2. **`concurrency: fortnox-e2e` hade serialiserat hela PR-matrisen** bakom en
   enda Fortnox-körning — refresh-token:en tål inte parallella refreshar.

`push: main` + nattlig schedule ger samma täckning utan den kostnaden.

### Lägen

| Läge | Vad som körs | Verifikat som skapas |
|---|---|---|
| push till `main` / schedule | full körning: syntetisk faktura **och** täckningsärendet | 3 |
| dispatch, `dry_run` | auth + `GET /3/voucherseries` | **0** |
| dispatch, *(inget)* | en syntetisk faktura bokförs och läses tillbaka | 1 |
| dispatch, `bookkeeping` | ett täckningsärende med **två betalande** körs upp i en riktig AVA-stack; BÅDA fakturorna bokförs och kontona verifieras | 3 |

`bookkeeping`-läget är det som svarar på frågan *"blir det bokfört rätt?"* — per
verifikat kontrolleras att Σdebet = Σkredit, att kundfordran debiterats med
bruttot, intäktskontot krediterats med nettot och momskontot med momsen, och att
kreditsidan summerar till bruttot så inget belopp fallit bort.

## Secrets och variabler

Ligger på environment **`fortnox-sandbox`** (Settings → Environments), inte som
repo-secrets — så åtkomsten kan begränsas separat.

| Secret | Vad |
|---|---|
| `AVA_FORTNOX_CLIENT_ID` | ur Developer Portal |
| `AVA_FORTNOX_CLIENT_SECRET` | ur Developer Portal |
| `AVA_FORTNOX_REFRESH_TOKEN` | från consent-rundan — **roterar vid varje körning**, se nedan |
| `AVA_FORTNOX_ROTATE_PAT` | fine-grained PAT med **`Environments: Read and write`** på repot, så jobbet kan spara den roterade token:en. Se fallgropen nedan — det är INTE `Secrets`-behörigheten |

| Variable (`vars`) | Default | Vad |
|---|---|---|
| `AVA_FORTNOX_CI_ENABLED` **(repo-nivå!)** | *(tom)* | måste vara `true` för att jobbet ska köra alls. Avstängningsknapp när samtycket gått ut — annars blir `main` röd på något som inte är ett kodfel. Sätts som **repository**-variabel: ett job-`if` utvärderas innan `environment:` resolvas, så en environment-variabel är alltid tom där och jobbet hade aldrig kört |
| `AVA_FORTNOX_VOUCHER_SERIES` | `A` | verifikatserie — måste vara **manuell** (`Manual: true`). `A` "Redovisning" är det; `B` "Kundfakturor" är INTE och avvisar våra verifikat. Sätt CI:s egen serie här |
| `AVA_FORTNOX_BOOKING_WINDOW` | *(tom → skriptet kastar)* | CI:s räkenskapsår, `"2030-01-01..2030-12-31"`. Se spärren ovan |
| `AVA_FORTNOX_ACCOUNT_TYPE` | *(tom)* | `service` för service-konto (rätt för CI) |
| `AVA_FORTNOX_KONTO_KUNDFORDRAN` | `1510` | kundfordran (debet) |
| `AVA_FORTNOX_KONTO_ARVODE` | `3041` | arvodesintäkt (kredit) |
| `AVA_FORTNOX_KONTO_MOMS` | `2611` | utgående moms 25 % (kredit) |

Kontona är ett **bokföringsbeslut per byrå** — defaults är BAS-standard och
ingen rekommendation.

## Det roterande refresh-token:et

Fortnox ogiltigförklarar den gamla refresh-token:en vid varje refresh
(access-token 1 h, refresh-token 45 dygn). Konsekvensen är kontraintuitiv:

> Ett refresh-token i en secret räcker till **exakt en körning** om inte det nya
> skrivs tillbaka.

Därför emitterar scriptet den roterade token:en till `GITHUB_OUTPUT` **direkt
efter första anropet**, före allt som kan fela, och workflow:et sparar den med
`if: always()`. Token:en skrivs aldrig till stdout.

Saknas `AVA_FORTNOX_ROTATE_PAT` fäller jobbet med ett tydligt fel — hellre det
än en tyst död token som visar sig först vid nästa körning.

> **Fallgrop 1:** skriv `gh secret set … ` *utan* `--body`. `gh` har ingen
> `-`-konvention för `--body` (bara för `--env-file`), så `--body -` hade
> lagrat strängen `-` som token och nästa körning hade dött i auth.
>
> **Fallgrop 2:** PAT:ens behörighet heter **`Environments`**, inte `Secrets`.
> `Secrets: Read and write` räcker för *repo*-secrets men ger `403 Resource not
> accessible by personal access token` på *environment*-secrets — och vår ligger
> på miljön `fortnox-sandbox`. Testa PAT:en INNAN du slår på CI:
>
> ```bash
> GH_TOKEN=<pat> gh secret set PROBE --repo ulrik-s/ava --env fortnox-sandbox --body probe \
>   && GH_TOKEN=<pat> gh secret delete PROBE --repo ulrik-s/ava --env fortnox-sandbox
> ```
>
> Går det igenom fungerar write-backen. Går det inte, och du slår på CI ändå,
> dör anslutningen vid första körningen.

## När token:en dött ändå

Refresh-token:en dör efter 45 dygn utan användning, och en misslyckad
write-back får samma effekt. Då krävs en ny consent-runda — den kan inte
automatiseras, eftersom den kräver en människa som godkänner i Fortnox:

Kör **lokalt** (aldrig i CI — `client_secret` ska inte lämna din maskin, och
`code` är engångs och kortlivad):

```bash
# 1. Bygg authorize-URL:en. Ingen hemlighet behövs i det här steget.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_REDIRECT_URI=… bun run fortnox:connect

# 2. Godkänn i browsern. Kontrollera att `state` kommer tillbaka oförändrat
#    (CSRF). Kopiera ?code=… ur adressfältet — landar du på en död sida är det
#    väntat, koden står ändå i URL:en.

# 3. Växla in koden → skriver ut refresh-token att lägga som secret.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_CLIENT_SECRET=… AVA_FORTNOX_REDIRECT_URI=… \
  bun run fortnox:connect --code <kod>
```

`redirect_uri` måste matcha registreringen i Developer Portal **tecken för
tecken** — annars avvisas anropet redan i steg 1.

> **Fortnox-egenhet (#1038):** jämförelsen sker på råsträngen, *före*
> URL-decode. En korrekt percent-encodad `redirect_uri=https%3A%2F%2F…` ger
> `redirect_uri_mismatch` trots att URI:n är registrerad exakt. `buildAuthorizeUrl`
> lägger därför på den oencodad — encoda den inte "för säkerhets skull".

Båda kontomodellerna är nu verifierade mot sandbox:

- **user-consent** (default, ingen `account_type`) — token knuten till den som
  godkände (`sub: 1@<tenant>`).
- **service-konto** (`AVA_FORTNOX_ACCOUNT_TYPE=service` på connect-scriptet) —
  egen identitet (`sub: 2@<tenant>`, `roles: []`), överlever att en anställd
  slutar. **Rätt modell för CI och obevakad drift**, eftersom ingen enskild
  persons konto kan dra undan mattan för workflow:et.

Se connector-README:n och [#213](https://github.com/ulrik-s/ava/issues/213).

## Uppsättningen som faktiskt körs

Konfigurerad 2026-09-05. Serie och år hänger ihop — läs båda innan du ändrar
något.

| Vad | Värde |
|---|---|
| Fortnox-företag | **Firma1-Test** (555555-5555) |
| Kontomodell | service-konto (`account_type=service`) |
| Räkenskapsår | **2027-01-01 – 2027-12-31**, skapat tomt för CI |
| Verifikatserie | **A** ("Redovisning", manuell) |

**Varför ingen egen serie.** Poängen med en egen serie är städbarhet: verifikat
kan bara tas bort bakifrån i sin serie. Men CI-*året* är redan CI:s eget och
tomt — 2027 skapades utan ingående balanser, så det innehåller uteslutande våra
manuella verifikat och kan raderas i sin helhet. Då tillför en separat serie
ingenting, och default-`A` är en variabel mindre att glömma.

Byter du till en verklig byrå där året delas med annat: skapa en egen serie
(nedan) och peka `AVA_FORTNOX_VOUCHER_SERIES` på den.

### Om du behöver en egen serie ändå

```bash
# 1. Se vilka serier som finns och vilka som är manuella.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_CLIENT_SECRET=… AVA_FORTNOX_REFRESH_TOKEN=… \
  bun run fortnox:series

# 2. Skapa CI-serien.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_CLIENT_SECRET=… AVA_FORTNOX_REFRESH_TOKEN=… \
  bun run fortnox:series --create Z "CI-testverifikat"
```

> Kör `fortnox:series` **lokalt** — det är ett adminverktyg som skriver ut den
> roterade refresh-token:en på stdout. **Kom ihåg att uppdatera secreten
> efteråt**, annars kan nästa CI-körning inte auth:a. Det gäller varje lokal
> körning mot skarp Fortnox: refresh-token:en roterar, och CI:s secret blir död
> i samma sekund.

### Räkenskapsåret

Skapas i GUI:t (kugghjulet → Räkenskapsår → *Skapa nytt*). Fortnox avråder
uttryckligen från att skapa räkenskapsår via API:t. Två val vid skapandet spelar
roll för CI:

- **Ingående balanser: NEJ** — håller året fritt från allt utom våra egna
  verifikat, vilket är villkoret för att kunna radera hela året.
- **Öppna detta räkenskapsår vid inlogg: NEJ** — annars landar du i det tomma
  CI-året varje gång du loggar in i företaget.

### Variablerna

```bash
gh variable set AVA_FORTNOX_VOUCHER_SERIES --env fortnox-sandbox --body A
gh variable set AVA_FORTNOX_BOOKING_WINDOW --env fortnox-sandbox --body '2027-01-01..2027-12-31'
gh variable set AVA_FORTNOX_ACCOUNT_TYPE   --env fortnox-sandbox --body service
gh variable set AVA_FORTNOX_CI_ENABLED --body true   # repo-nivå — se tabellen ovan
```

`AVA_FORTNOX_CI_ENABLED` sätts **sist**, och först när
`AVA_FORTNOX_ROTATE_PAT` finns. Utan PAT:en fäller write-back-steget, och
token:en har redan roterat då — första körningen skulle alltså döda
anslutningen i stället för att förnya den.

## Källor

- [Fortnox API v3 apidocs](https://apps.fortnox.se/apidocs)
- [Best practices — Vouchers](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers)
- [Ta bort eller ändra felaktig verifikation](https://support.fortnox.se/produkthjalp/bokforing/ta-bort-eller-andra-felaktig-verifikation)
- [Räkenskapsår](https://support.fortnox.se/produkthjalp/bokforing/rakenskapsar)

## Kända begränsningar

- **Går inte att köra från Claude Code-containern.** `bun`:s `fetch` når inte
  igenom containerns proxy till Fortnox (`socket connection was closed
  unexpectedly`) medan `curl` gör det. GitHub-runnern har ingen sådan proxy.
  Gäller bara containern — från macOS-värden går `bun`:s `fetch` fram
  (verifierat 2026-09-05).
- **Varje lokal körning bränner CI:s token.** Refresh-token:en roterar vid
  första anropet, så ett lokalt `fortnox:e2e` gör secreten i `fortnox-sandbox`
  död. Kör lokalt bara med en token du själv skaffat via `fortnox:connect`, och
  skriv tillbaka den roterade till secreten efteråt.
- **Testfakturan är syntetisk** (125,00 kr inkl moms, `E2E-<tidsstämpel>`) och
  byggs i minnet. Det som testas är ledger-vägen, inte repo-lagret — det har
  egna tester.
- **Bilagor (#785) täcks inte** av e2e:t ännu; `uploadInboxFile` +
  `connectFileToVoucher` är enhetstestade men inte körda skarpt.
