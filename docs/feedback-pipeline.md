# Från användarens förfrågan till produktion

Användarna rapporterar buggar och föreslår förbättringar direkt i AVA.
Claude-agenter i molnet verifierar, bryter ner, granskar och implementerar
dem. Allt går via CI till `main`. Produktion får en ändring först när Ulrik
sätter en `v*`-tagg.

> **Flödet i detalj** — tillstånd, etiketter, vem som får flytta vad,
> villkor och timeouter — står i `tooling/agents/flow.yaml` och ritas i
> [`agent-flow.md`](agent-flow.md) (genererad: `bun run flow:gen`).
> Flödesvakten (`.github/workflows/agent-flow.yml` här och `flodesvakt.yml` i
> ava-feedback) håller etiketterna i takt med flödet.

```
 AVA: "Bugg eller förslag"
        │ (servern, token med Issues: write och Contents: write för bilagorna)
        ▼
 ulrik-s/ava-feedback  (PRIVAT)        user-request
        ▼
 Loop 1 verifiering  ──►  rapport + undersökt [+ ej-bekräftad]
        │ Ulrik läser rapporten och sätter  verifierad   ← enda mänskliga grinden in
        ▼
 Loop 2 nedbrytning  ──►  ulrik-s/ava (PUBLIKT), avidentifierade issues
        │                               agent-task + att-granska
        ▼
 Loop 3 granskning   ──►  granskad
        ▼
 Loop 4 implementation ─► PR  agent-pr + att-granska
        ▼
 Loop 3 granskning   ──►  granskad  (eller behöver-ändras → loop 4)
        ▼
 Loop 3 mergar den granskade sha:n när CI (inkl. Agentvakt) är grön ──► main
        ▼
 main ──► staging.ava-crm.io (inom 5 min)
        ▼
 Ulrik provar på staging, taggar:  git tag vX.Y.Z && git push origin vX.Y.Z
        ▼
 ava-crm.io (inom 5 min) ──► Loop 2 stänger förfrågan: levererad + release:vX.Y.Z
        ▼
 Användaren ser "Levererad i vX.Y.Z" under "Dina förfrågningar"
```

**Beroenden mellan förfrågningar (loop 2):** förfrågningar bryts ner i
beroendeordning, inte i den ordning de verifierades. Skriv `Beror på
ava-feedback#M` i en kommentar på förfrågan så väntar den på M (M bryts ner
först; är M inte verifierad blir förfrågan `blockerad`). Loop 2 lägger dessutom
själv `Beror på #N` när en ny implementations-issue rör samma kod som en öppen
från en annan förfrågan. Loop 4 bygger en issue först när alla dess beroenden
är mergade; ett beroende som stängts utan att byggas blockerar.

**Omprövning (loop 2, en gång per release):** funktioner byggs också utanför
kedjan. Varje ny release prövas mot alla öppna förfrågningar. Är en helt
eller delvis löst, eller innehåller den flera saker, går den tillbaka till
loop 1 (som hjälper användaren, delar upp och undersöker resten). Har Ulrik
redan beslutat (`verifierad`/`nedbruten`) får han i stället `blockerad` med
vad som behöver avgöras. Kvittot står på statusissuen
(`<!-- omprövning:vX.Y.Z -->`).

## Inkorgen för allt arbete

`ulrik-s/ava-feedback` är inkorgen för **allt** nytt arbete, inte bara
användarnas förfrågningar: Ulriks egna idéer och buggar, agenternas
uppföljningar och teknisk skuld går samma väg. En förfrågan som inte kommer
från en användare i AVA har flaggan `intern` (satt av Ulrik eller klockan).
Delar loop 1 upp en intern förfrågan sätter klockan `intern` på delarna
(sub-issues till originalet), eftersom en agent inte får sätta den själv.
Loop 1 verifierar den som andra, men det finns ingen användare att fråga:
frågor går till Ulrik (`blockerad`), och AVA visar den aldrig för användarna
(de ser bara förfrågningar med sitt eget märke).

I `ulrik-s/ava` hör bara arbetsorder hemma: `agent-task` (loop 2),
`refaktorisering` och `arkitektur-rapport` (loop 5). Klockan flyttar ett
annat issue till inkorgen som `intern` + `bugg`/`förslag` när det är äldre än
2 timmar och ingen öppen PR stänger det, så att direkt arbete i en session
(issue + PR) får vara kvar.

Flytten kräver en token som når båda repona: hemligheten
`FLOW_TRANSFER_TOKEN` i `ulrik-s/ava` (en fine-grained PAT med *Issues: read
and write* på båda repona), som `agent-flow.yml` skickar till klockans steg.
Utan den loggar klockan bara vad som skulle flyttas. Nekar GitHub flytten
(token räcker inte till) står det som en varning på klockans körning. Klockan
går vidare med resten och försöker igen nästa timme.

Genomgången 2026-11-18 flyttade de 70 gamla issuena: de klara och
inaktuella stängdes med belägg, resten ligger i inkorgen som `intern` +
`undersökt` med genomgången som verifieringsrapport och väntar på Ulriks
`verifierad`.

## Tavlan

Ulriks vy är projekttavlan **AVA – flödet** (GitHub Projects, användarägd).
Varje öppen förfrågan i inkorgen är ett kort i den kolumn som dess etiketter
ger: Ny, Att besluta, Svara, Väntar på användaren, Godkänd, Byggs, Klar.
Etiketterna är sanningen; tavlan följer dem. Två flyttar är Ulriks beslut:

- **till Godkänd** (från Ny eller Att besluta) → `verifierad`, satt med
  Ulriks token, så flödesvakten ser det som hans beslut,
- **till Avböjd** (där inget byggs ännu) → stängd som "not planned".

Andra flyttar läggs tillbaka. Fältet **Prio** följer prio-flaggan, och ändrar
Ulrik det på tavlan blir det etiketten. Fältet **Rekommendation** visar loop 1:s
rekommendation (`rek-godkänn`, `rek-avböj`, `rek-fråga`), så att Ulrik kan
sortera och godkänna de gröna i klump (tabellvyn: markera rader, sätt Status).

**Automatiskt godkännande.** En liten bekräftad bugg eller ett internt verktyg,
inom ADR:erna och utan risk (pengar, inloggning, migration, klientdata,
skyddade sökvägar), får `auto-godkänn` av loop 1 (kriterierna i
`1-verifiering.md`, "Rekommendation") och står i **Godkänns automatiskt**.
Efter 24 timmar utan veto sätter synken `verifierad` med Ulriks token och en
kommentar (markerad `<!-- tavlan -->`, så att agenterna inte läser den som
Ulriks ord). Koden kontrollerar det som syns i etiketterna: en användares
förslag godkänns aldrig automatiskt, och inget som väntar på svar. **Veto:**
flytta kortet till Att besluta (flaggan tas bort och loop 1 sätter den inte
igen) eller till Avböjd. Bara Ulriks "ska vi bygga det" hoppas över;
granskningen av arbetsordrar och PR:er, CI och Agentvakten gäller som vanligt.

**Läge** (textfält på korten) säger vad som händer nu, i klartext: "Loop 1
verifierar", "Godkänd — loop 2 bryter ner den", "Byggs: 1 av 3 arbetsorder
klara" (ur arbetsordrarnas `Intag:`-rad), "Godkänns automatiskt 21 nov 21:30",
"Levererad i v0.7.42". Synken skriver det när det ändrats, direkt efter en
flytt, så att Ulrik ser att flytten tagits emot. När alla arbetsordrar är
klara står det "Byggd — kommer med nästa release" (automatisk tagg var 6:e
timme, `release` i flow.yaml).

**Blockerade arbetsordrar** (#1779) är egna kort i **Svara** (issuen i ava,
klickbar): läs senaste kommentaren och svara där, eller flytta kortet till
**Godkänd** för att släppa den — `blockerad` tas bort, arbetsordern får
`människa-godkänd` och dess tillstånd sätts igen så att agenten startar
direkt; när dess PR kommer sätter synken `människa-godkänd` på den med
Ulriks token, som Agentvakten kräver för skyddade sökvägar. **Avböjd** stänger
arbetsordern. Förfrågans eget kort står kvar i Byggs och hänvisar dit. När
arbetsordern inte längre är blockerad arkiveras kortet.

GitHub kan inte starta en workflow när ett kort flyttas, och GitHubs schema
är för opålitligt (var-5:e-minut-schemat gick två gånger på ett dygn). Därför
läser `tavla.yml` (i ava, publikt) av tavlan **varje minut** i knappt sex
timmar med `tooling/scripts/flow-board.ts` och startar sedan nästa körning
själv; schemat varje timme är bara reserv. Stoppa kedjan genom att stänga av
workflowen (Actions → Tavla → Disable). Projektet, kolumnerna, Prio-fältet och tavelvyn skapas av synken själv.
Kräver hemligheten `FLOW_BOARD_TOKEN` i ava: en klassisk PAT med `project`
och `repo`. Statusissuen (#11) finns kvar för larmen, som tavlan inte kan
skicka.

## Design av större förfrågningar

En godkänd förfrågan tar snabbvägen till arbetsordrar om den är liten (storlek
S), följer befintliga ADR:er och inte rör något riskområde. Annars går den
designvägen (#1746):

1. **`designas`**: loop 2 skriver `## Design (runda N)` på förfrågan: mål,
   datamodell, API, gränssnitt, grunder, arkitektur, risker, uppdelning och
   öppna frågor ("Design" i `2-nedbrytning.md`).
2. **Frågor**: hur något ska bete sig går till användaren (`väntar-på-användaren`),
   en ny eller ändrad ADR eller ett produktval till Ulrik (`blockerad`, kortet
   hamnar i Svara). Tekniska val inom ADR:erna är inga frågor: agenten väljer
   och motiverar. Har runda 2 fortfarande frågor samlas alla i en enda fråga
   till Ulrik.
3. **`design-granskas`**: loop 3 granskar designen mot koden och ADR:erna,
   och godkänner (`design-godkänd`) eller skickar tillbaka (`designas`).
4. **`design-godkänd`**: loop 2 bryter ner den enligt designens uppdelning.

Ulrik ser bara frågorna. I AVA syns designvägen som "Verifierad". På tavlan
står den i kolumnen **Designas**.

## Beroenden

Arbetsordrarna i ava bildar ett nät (#1720): kräver en ändring att koden ser
ut på ett visst sätt, beror den på arbetsordern som bygger det. Ett nät, inte
träd, eftersom en grund ofta bär flera funktioner, och inte epics: epiken är
förfrågan i inkorgen, medan en grund kan höra till flera.

- **Loop 2** bygger grunden först ("Grunden först" i `2-nedbrytning.md`):
  använd det som finns, bero på den öppna arbetsorder som bygger det, eller
  gör en egen `Grund:`-arbetsorder som flera kan bero på. Loop 3 sätter
  `behöver-ändras` på en arbetsorder som bygger en grund en gång till.
- **`Beror på #N`** i arbetsordern är källan. Flödesvakten speglar raderna som
  GitHub-beroenden (blocked by), så att nätet syns (Blocked-ikonen) och
  räknas. Beroenden som Ulrik lägger direkt i GitHub gäller också. GitHub
  vägrar cirklar; en sådan rad gör arbetsordern `blockerad` med en förklaring.
- **Vakten** startar inte loop 4 på en arbetsorder som har öppna blockerare
  (`wait_for_blockers` på `granskad` i flow.yaml), och startar den när den
  sista stängs (`issues: closed` i agent-flow.yml). Klockan knuffar inte
  blockerade, och när de blir fria tar knuffen dem.
- **Prioriteten ärvs** (`tooling/scripts/flow-deps.ts`, varje timme): den
  egna står på raden `Prioritet:` (från förfrågans prio), och en grund får
  den högsta bland det som väntar på den, som `prio-*`-flagga. Loop 4 tar
  högst först.
- **Statussidan**: en blockerad sak larmar inte som fastnad; den står under
  "Rör sig" med hur många beroenden den väntar på. En grund visar hur många
  som väntar på den.

## Varför det ser ut så här

- **Privat intag.** Kodrepot är publikt. Användare skriver klientnamn och
  ärendeuppgifter, och det får aldrig hamna där (advokatsekretess, GDPR).
  Användarnas text stannar i `ava-feedback`. Agenterna skriver egna,
  avidentifierade issues i `ava`.
- **Först verifieras det.** Verifieringsagenten försöker återskapa buggen,
  eller kontrollera att förslaget behövs och inte redan finns, och skriver en
  rapport. Den fattar inget beslut. Ulrik bestämmer på rapporten, inte på
  användarens ord.
- **Ulrik godkänner, och agenterna kan inte förfalska det.** Användartext som
  styr agenter som skriver kod är en väg för prompt injection. Molnagenterna
  agerar som Ulriks konto, så en etikett bevisar inget i sig. Därför räknas
  `verifierad` bara om issuens händelselogg visar att den sattes av `ulrik-s`
  **utan** `performed_via_github_app` (alltså inte via Claudes app). Se
  [Kontrollera godkännandet](#kontrollera-godkännandet-en-gång).
- **Gränserna är mekaniska.** Promptarna säger vad agenterna inte får göra,
  och **Agentvakten** (`.github/workflows/agent-guard.yml`, krävd kontroll)
  fäller en agent-PR som
  - rör skyddade sökvägar (CI, deploy, auth, agentpromptarna …),
    och sedan #1873 också pengalogiken, de delade schemana och migrationerna:
    `src/lib/shared/schemas/`, `tooling/db/migrations/` (alla filer, även
    additiva), `src/lib/server/billing/`, `src/lib/shared/billing/billing-*.ts`,
    `src/lib/shared/billing/kostnadsrakning*.ts`, `src/lib/shared/billing/coverage-billing.ts`,
    `src/lib/shared/billing/invoice-calc.ts`, `src/lib/server/routers/invoice.ts`,
    billingRun-routern (`src/lib/server/routers/billingRun.ts` och
    `src/lib/server/routers/billingRun/`), momsen (`src/lib/shared/billing/vat.ts`,
    `invoice-vat.ts`, `expense-vat.ts`, `acconto-vat.ts`), taxorna
    (`src/lib/shared/billing/brottmalstaxa.ts`, `forordnandetaxa.ts`) och bokföringen
    (`src/lib/shared/accounting/`). Samma lista står i `.github/CODEOWNERS`.
  - innehåller en destruktiv migration,
  - är fler än 30 på ett dygn. Bara det som kan mergas räknas: mergade PR:er
    och öppna utan `blockerad`. En PR som väntar på Ulriks `människa-godkänd`
    eller stängts utan merge räknas inte (2026-11-27; den 26/11 band sju
    väntande PR:er en fjärdedel av dygnets kvot),
  - eller inte har `granskad`.

  `människa-godkänd` (bara Ulrik) släpper de två första. Granskningsloopen
  mergar dessutom bara exakt den commit den granskat (`sha` i merge-anropet),
  så en push efter granskningen kan aldrig slinka med.
- **Additiva migrationer.** En release backas med en äldre tagg, men databasen
  backas inte. Gammal kod måste därför fungera mot det nya schemat.
- **Staging är en riktig server**, inte Pages-demon. Demon saknar server,
  Postgres, migrationer och inloggning, så den visar inte det som brukar gå
  sönder.

## Etiketterna

Definieras i `tooling/agents/labels.json`. Skapas och uppdateras med
`bash tooling/scripts/setup-agent-labels.sh`.

| Repo | Etikett | Sätts av | Betyder |
|---|---|---|---|
| ava-feedback | `user-request` | servern | Ny förfrågan från knappen |
| ava-feedback | `bugg` / `förslag` | servern | Typ |
| ava-feedback | `väntar-på-användaren` | loop 1–4 / Ulrik | En fråga till användaren väntar på svar (i AVA) |
| ava-feedback | `dubblett` | loop 1 | Samma sak som en äldre förfrågan. Byggs inte separat, och får originalets leverans (loop 2). Användaren ser *Hanteras ihop med en tidigare förfrågan* |
| ava-feedback | `uppdelad` | loop 1 | Förfrågan tog upp flera saker som inte hör ihop. Loop 1 skapade en egen förfrågan per sak (samma ägare, användarens rader ordagrant, `Del av #N`) kopplade dem som sub-issues till originalet, och en Action stänger originalet. Användaren ser *Uppdelad i flera förfrågningar* |
| ava-feedback | `finns-redan` | loop 1 | Det efterfrågade fanns redan (eller var avsett beteende). Loop 1 har visat användaren vägen och hen har bekräftat det (eller inte svarat på 7 dagar). Inget byggs och Ulrik behöver inte besluta. En Action stänger issuen. Användaren ser *Finns redan i AVA*; behöver hen något mer skickar hen en ny förfrågan |
| ava-feedback | `undersökt` | loop 1 | Verifieringsrapporten finns |
| ava-feedback | `ej-bekräftad` | loop 1 | Buggen/behovet kunde inte bekräftas |
| ava-feedback | `verifierad` | **Ulrik** | Sant och värt att bygga — får brytas ner. Sätts på en `undersökt` förfrågan; på `nedbruten` eller `levererad` nekar flödesvakten den (även för Ulrik) |
| ava-feedback | `nedbruten` | loop 2 | Issues finns i ava |
| ava-feedback | `levererad`, `release:vX` | loop 2 | Ute i produktion |
| ava | `agent-task` | loop 2 | Implementations-issue |
| ava | `att-granska` | loop 2 / 4 | Väntar på loop 3 |
| ava | `granskad` | loop 3 | Godkänd (issue: får byggas; PR: får mergas) |
| ava | `behöver-ändras` | loop 3 | PR:en går tillbaka till loop 4 |
| ava | `pågår` | loop 4 | Under arbete |
| ava | `agent-pr` | loop 4 | PR från en agent (Agentvakten gäller) |
| båda | `blockerad` | alla | Väntar på Ulrik, och ingen agent rör den |
| ava | `människa-godkänd` | **Ulrik** | Agent-PR får röra skyddade sökvägar/migrationer |
| ava | `arkitektur-rapport` | loop 5 | Veckans arkitekturgenomgång (siffror, avdrift, förslag) |
| ava | `refaktorisering` | loop 5 | Förslag. Byggs först när **Ulrik** satt `granskad` |

Användaren ser statusen i AVA: *Mottagen → Undersökt — väntar på beslut*
(eller *Kunde inte bekräftas*) *→ Verifierad → Under arbete → Levererad i vX*.
Stängs issuen utan leverans visas *Avslutad*.

När förfrågan är nedbruten visar tråden i AVA också hur långt den kommit
(#2216): en tidslinje (*Mottaget → Godkänt → Byggs: N av M delar klara →
Levereras*), delarna — arbetsordrarna i `ava` med raden
`Intag: ava-feedback#N`, rubriken utan Conventional-Commit-prefix — som
*klar*, *pågår*, *i kön* eller *väntar på beslut* (`blockerad`), och en
uppskattning i ord, aldrig ett datum:

    dygn ≈ (delar före i kön + återstående delar) ÷ takten + ½ dygn till release

Takten är mergade `agent-pr` de senaste 7 dygnen ÷ 7 (10 per dygn om sökningen
fallerar). Kön före är andra förfrågningars delar i kön som skapades före den
här förfrågans äldsta återstående del — en förenkling: den riktiga ordningen tar
också hänsyn till prioritet. Väntar en del på beslut eller förfrågan på
användaren står det så, utan uppskattning. Servern hämtar arbetsordrarna med
sök-API:t (en sida per 100, ändrade de senaste 90 dygnen) och takten med ett
anrop till, med samma token, och delar svaret mellan alla användare i 5 minuter
(`src/lib/server/feedback/github-work-orders.ts`). Regeln:
`src/lib/shared/feedback-eta.ts`.

### Så verifierar du en förfrågan

Läs verifieringsrapporten på issuen i `ava-feedback`, och sätt sedan
etiketten själv, i webbläsaren eller med `gh` på din dator:

```bash
gh issue edit <nr> -R ulrik-s/ava-feedback --add-label verifierad
```

Är rapporten "Ej bekräftad" kan du ändå verifiera, om du vet bättre. Du kan
också fråga användaren, eller stänga issuen (användaren ser då *Avslutad*).

### Dialog med användaren

Användaren läser och svarar i AVA: "Bugg eller förslag" i sidomenyn visar en
tabell över hens förfrågningar, och en **röd prick** (på knappen och på raden)
när något nytt har skrivits till hen. Ett klick öppnar dialogen, där hen kan
svara. Knappen hämtar läget var 5:e minut. "Senast läst" sparas i
användarens inställningar (`feedback.seen`), så pricken försvinner på alla
enheter.

Vad användaren ser styrs av markörer först i kommentaren:

| Kommentar börjar med | Visas för användaren som | Skrivs av |
|---|---|---|
| `<!-- till-anvandaren -->` | **Claude** (via Claudes app) eller **Ulrik** (annars) | verifieringsagenten, eller du |
| `<!-- ava-user-reply:<id> -->` | **Du** (bara för den användaren) | AVA-servern, när användaren svarar |
| allt annat (rapporter, anteckningar) | syns inte | |

Verifieringsagenten frågar användaren när svaret bara finns hos hen, sätter
`väntar-på-användaren` (användaren ser *Väntar på ditt svar*) och fortsätter
när hen har svarat. Högst två frågerundor, och efter 7 dagar utan svar skrivs
rapporten ändå.

Även efter `verifierad` frågar agenterna användaren, inte dig, om **hur något
ska bete sig** (regel 2c i `tooling/agents/0-gemensamma-regler.md`). Det gäller
nedbrytning, granskning och implementation. Frågan har färdiga alternativ
inom det du verifierat. Svaret dyker upp i AVA, och agenten fortsätter
själv när det kommer. Du får bara frågor om arkitektur, säkerhet, skyddade
sökvägar och omfång.

**Skriva till användaren själv:**

```bash
printf '%s\n' '<!-- till-anvandaren -->' 'Hej! Gäller det alla fakturor eller bara den från i måndags?' > fraga.md
gh issue comment <nr> -R ulrik-s/ava-feedback --body-file fraga.md
gh issue edit <nr> -R ulrik-s/ava-feedback --add-label väntar-på-användaren
```

Du behöver inte ta bort `undersökt`. När användaren svarar tar
verifieringsagenten issuen vid nästa körning, även om rapporten redan finns.
Den skriver då en ny rapport med svaret inräknat.

**Etiketternas livscykel under verifieringen:**

```
ny förfrågan ─► agenten undersöker
                 ├─ frågor ─► väntar-på-användaren (INTE undersökt)
                 │              │ användaren svarar i AVA
                 │              ▼ nästa körning: tar bort väntar-…, fortsätter
                 │              (högst 3 rundor; 7 dagar utan svar → Ej bekräftad)
                 └─ klart ──► rapport + undersökt [+ ej-bekräftad] ─► du: verifierad
du frågar efter rapporten ─► väntar-på-användaren ─► svar ─► agenten tar bort
                              undersökt och skriver en ny rapport
```

## Uppsättning (en gång)

### 1. Token för knappen

GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*:

- **Repository access:** *Only select repositories* → `ulrik-s/ava-feedback`
- **Permissions:** *Issues: Read and write* och *Contents: Read and write* (Metadata: read följer med).
  Contents behövs för bilagorna i förfrågningarna (#1788) — bilder, PDF och Word- eller
  Excel-dokument: de sparas som filer under `attachments/` i intag-repot och länkas från
  issuen. Utan Contents får en användare som bifogar en fil beskedet att bilagorna inte
  kunde tas emot; texten går att skicka.
- **Expiration:** ett år, med en kalenderpåminnelse.

Lägg in i `/srv/ava/ava-server.env` på produktionsservern:

```bash
AVA_FEEDBACK_GITHUB_TOKEN=github_pat_…
AVA_FEEDBACK_REPO=ulrik-s/ava-feedback
```

Värdena läses vid nästa deploy (nästa tagg). Vill du ha dem direkt:
`cd /srv/ava && set -a && . ./ava-server.env && set +a && docker compose -f tooling/docker/docker-compose.production.yml up -d server-first`.
Knappen "Bugg eller förslag" syns då längst ned i sidomenyn. Utan token
syns den inte.

Staging får **ingen** token. Då hamnar inga testförfrågningar bland de riktiga.

### 2. Etiketterna

```bash
bash tooling/scripts/setup-agent-labels.sh   # ulrik-s/ava-feedback + ulrik-s/ava
```

### 3. Agentvakten som krävd kontroll

Klart sedan 2026-11-09: **Agentvakt** är en krävd kontroll på `main`. GitHub
vägrar därför granskningsloopens merge tills den är grön.

### 4. Staging

Se [Staging](#staging) nedan.

### 5. Looparna i molnet

Fyra **schemalagda molnagenter** (`/schedule` i Claude Code). De körs på
Anthropics servrar, så din dator behöver inte vara igång, och de använder
din Claude-prenumeration (ingen separat kostnad för servern).

Förutsättningar:

- **Claudes GitHub-app** installerad på både `ulrik-s/ava` och
  `ulrik-s/ava-feedback`. Använd appen, inte `/web-setup` (som skickar din
  egen `gh`-token): kontrollen av ditt godkännande bygger på att agenternas
  händelser bär appens märke.
- Varje agent får **båda** repona.
- Nätverk: standard (*Trusted*) räcker. Agenterna når GitHub och
  paketregistren, och verifieringen återskapar buggar i sin egen miljö (demon
  och tester), inte på staging, som kräver inloggning.

Prompten är kort och pekar på filen i repot. Instruktionerna versioneras
alltså med koden, och agenterna kan inte ändra dem (Agentvakten skyddar
`tooling/agents/`).

| Agent | Schema (kortast tillåtna är 1 h) | Prompt |
|---|---|---|
| 1 Verifiering | varje timme + ny förfrågan (GitHub) | `Läs och följ tooling/agents/1-verifiering.md i ulrik-s/ava.` |
| 2 Nedbrytning + uppföljning | var 3:e timme + flödesvakten + ny release | `Läs och följ tooling/agents/2-nedbrytning.md i ulrik-s/ava.` |
| 3 Granskning + merge | var 3:e timme + flödesvakten | `Läs och följ tooling/agents/3-granskning.md i ulrik-s/ava.` |
| 4 Implementation | var 3:e timme + flödesvakten | `Läs och följ tooling/agents/4-implementation.md i ulrik-s/ava.` |
| 5 Arkitektur | måndagar 06:00 | `Läs och följ tooling/agents/5-arkitektur.md i ulrik-s/ava.` (bara `ulrik-s/ava`) |
| 6 PR-vakt | varje timme | `Läs och följ tooling/agents/6-pr-vakt.md i ulrik-s/ava.` (bara `ulrik-s/ava`) |

PR-vakten ser till att alla öppna PR:er blir gröna och mergade:
- startar om CI som hänger mer än 60 minuter (avbryter körningen eller, på
  `claude/`-brancher, pushar en tom commit; annars `blockerad` åt Ulrik),
- kör om flaky jobb,
- rättar rött CI och konflikter på `claude/`-brancher,
- granskar Dependabot-PR:er och Ulriks egna PR:er,
- mergar det som är granskat och grönt.

Andra PR:er än Dependabots som rör skyddade sökvägar mergar den bara med
Ulriks `människa-godkänd`.

En körning utan arbete avslutas efter en rad. Tätare schema ger snabbare
leverans men drar mer av prenumerationen. Börja glest och öka när du ser hur
det går.

**Pausa:** stäng av agenterna i `/schedule`, eller sätt `blockerad` på en
enskild issue eller PR.

### Kontrollera godkännandet (en gång)

Agenterna agerar som ditt GitHub-konto. Skillnaden mellan ditt `verifierad`
och en agents är att agentens händelse bär Claudes app i
`performed_via_github_app`. Det är inte dokumenterat, så kontrollera det
efter första körningen. Ta en issue som verifieringsagenten har satt
`undersökt` på:

```bash
gh api "repos/ulrik-s/ava-feedback/issues/<nr>/events" \
  --jq '.[] | select(.event=="labeled") | {label: .label.name, actor: .actor.login, app: .performed_via_github_app.slug}'
```

- `undersökt` ska ha `app` satt (t.ex. `claude`).
- `verifierad` som du satt själv ska ha `app: null`.

**Saknar `undersökt` app-märket** kan grinden inte skilja dig från agenterna.
Stäng då av agenterna och skaffa ett separat GitHub-konto för dem (t.ex.
`ava-agent`, med skrivrätt på båda repona), och koppla Claude-molnet till det
kontot. Byt sedan `ulrik-s`-kontrollen i `0-gemensamma-regler.md` till "inte
`ava-agent`".

## Staging

`staging.ava-crm.io` är en **egen server**: samma installation som
produktionen, men den följer `main`. Ett eget värdnamn på samma server som
produktionen skulle dela Caddy (port 80/443), Docker-nätverk och
backupkataloger med produktionen. En liten VPS (2 GB RAM räcker för bygget)
håller staging helt isär.

1. **Server + DNS:** en VPS med Docker, och en A-post `staging.ava-crm.io` → dess IP.
2. **Inloggning:** registrera `https://staging.ava-crm.io/oauth2/callback`
   som redirect-URI i IdP:n. Helst en egen klient, så delar staging och
   produktionen inga hemligheter. Lägg en egen `OAUTH2_PROXY_COOKIE_SECRET`.
3. **Installera** enligt [deploy-server-first.md → Installation](./deploy-server-first.md#installation),
   med dessa skillnader i `ava-server.env`:

   ```bash
   AVA_DOMAIN=staging.ava-crm.io
   AVA_DEPLOY_TRACK=main            # följ main, inte taggar
   AVA_ERROR_ENVIRONMENT=staging
   AVA_EMAIL_DISABLED=1             # staging skickar aldrig e-post
   # inga AVA_FEEDBACK_*, inga AVA_FORTNOX_*: inget riktigt utanför staging
   ```

4. **Demodata** i den nya, tomma databasen (efter `db-migrate.ts`, med
   `avarun` från installationsavsnittet):

   ```bash
   AVA_ORG_NAME="AVA Staging" AVA_ADMIN_EMAIL=<din inloggning> AVA_ADMIN_NAME=Ulrik \
     avarun tooling/scripts/seed-selfhosted-local.ts
   avarun tooling/scripts/seed-demo-into-server.ts
   ```

   Det är påhittad data, aldrig en kopia av produktionen.
5. **Första deployen** för hand: `bash tooling/scripts/deploy-prod.sh`. Den
   installerar `ava-deploy.timer`, som sedan deployar varje ny commit på `main`
   inom fem minuter. `curl https://staging.ava-crm.io/readyz` visar
   `"release":"v0.4.0-3-gabc1234"`, alltså senaste taggen plus antal commits.
6. **Backup** behövs inte (demodata). Sätt inte upp nattjobben där.

## Arkitekturen i schack

När användarnas önskemål byggs av agenter är risken att koden driver iväg: samma
sak löst på två sätt, logik i fel lager, filer som växer. Tre lager håller
emot, ovanpå det CI redan kontrollerar (dependency-cruisers lagergränser,
komplexitet < 8, jscpd, knip, täckning, Agentvakten).

**1. Agenterna passar in i arkitekturen** (regel 4b i
`tooling/agents/0-gemensamma-regler.md`).
- Nedbrytningen anger för varje issue en **förebild**: befintlig kod som gör
  samma sorts sak, plus de ADR:er som gäller.
- Implementationen följer förebilden.
- Granskningen letar aktivt efter avdrift och skickar tillbaka den.
- Kräver något ett **nytt** mönster, beroende eller lager stoppas det
  (`blockerad`) med ett **ADR-utkast**, och du bestämmer. Agenter inför
  aldrig sådant själva.

**2. Veckans arkitekturgenomgång** (loop 5, måndagar).
1. Agenten mäter med `tooling/scripts/arch-metrics.ts`: storlek per område,
   största filer, hotspots (churn × storlek), duplicering och beroenden.
   Mätningen är deterministisk och skyddas av Agentvakten.
2. Den jämför med förra veckan, läser veckans mergade PR:er och skriver en
   rapport-issue (`arkitektur-rapport`): avdrift, det som är friskt, och siffrorna.
3. Den föreslår **högst tre** små, beteendebevarande refaktoriseringar, som
   issues med `refaktorisering`.

**3. Mekaniska regler i CI.**
- **Filstorleksspärren** (`bun run file-size`, i `quality:fast` och i CI:s
  statiska analys): ingen produktionsfil över **400 rader**. De 25 filer som
  redan var större står i `tooling/config/file-size-baseline.json` och får
  krympa men aldrig växa. Krymper en fil måste baslinjen skärpas (`--update`
  kan bara skärpa). Agentvakten låter en agent-PR ändra baslinjen bara åt
  det strängare hållet.
- **Routertaket** (#2176, samma skript): en tRPC-router
  (`src/lib/server/routers/`, även undermapparna) får ha högst **250 rader**.
  Routern validerar indata, väljer procedur och anropar en tjänst under
  `src/lib/server/<domän>/` (förebild: `loadPeriodWork` i
  `src/lib/server/reports/period-work.ts`). Routrarna som redan var större
  står i `tooling/config/router-size-baseline.json`, med samma ratchet och
  samma undantag i Agentvakten.
- **ADR:er blir regler:** varje vecka går genomgången igenom nästa ADR:er och
  föreslår högst en ny regel i `dependency-cruiser.cjs` för en gräns som ADR:en
  beskriver men som inte kontrolleras. Regel-PR:en rör `tooling/config/` och
  behöver därför både din `granskad` (på förslaget) och din `människa-godkänd`
  (på PR:en).
- **Inga nya beroenden** i agent-PR:er: `package.json` och `bun.lock` är
  skyddade av Agentvakten.

**Du godkänner** ett förslag genom att sätta `granskad` på det (själv,
inte via en agent). Då bygger implementationen det, men först när inga
användarönskemål väntar. Det går genom samma granskning och samma tak på 30
PR:er per dygn. Befintliga tester får inte ändras: de är kontraktet. Förslag
du inte godkänner stängs efter fyra veckor.

## Releasa

1. Prova på staging. `readyz` visar exakt vilken commit som kör.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. Allt som ligger på `main`
   följer med.
3. Hittar du en dålig ändring på staging innan du taggar: `git revert` den
   på `main` (vanlig PR), eller sätt `blockerad` på dess issue och vänta med
   taggen.
4. Rollback i produktion: tagga om en äldre commit som en ny, högre version
   (se deploy-server-first.md → Rollback). Databasen backas inte, och därför
   kräver Agentvakten additiva migrationer.

### Nytt i AVA (#2010)

Varje agent-PR har raden `**För användarna:** <en mening>` (eller `—` när
inget syns). L4 skriver den, L3 granskar den: vardaglig svenska, ingen kod,
inget ur förfrågningarna. När taggen sätts samlar `release.yml`
(`tooling/scripts/release-user-notes.ts`) raderna från releasens PR:er under
`## Nytt i AVA` i GitHub-releasen, direkt, utan godkännande. Servern läser
avsnittet ur kodrepots publika releaser (`releaseNotes.list`, cache 10 min),
och AVA visar "Nytt i AVA" första gången man öppnar appen efter en
uppdatering, med användarens egna levererade förfrågningar i versionen.
Länken "Nytt i AVA" under versionen i sidofältet öppnar den igen. Vill du
ändra en text i efterhand: redigera avsnittet i GitHub-releasen; AVA läser
om den inom 10 minuter.

## Filer

| Vad | Var |
|---|---|
| Knappen + dialogen | `src/components/shell/feedback-button.tsx` |
| Trådens tidslinje, delar och uppskattning | `src/components/shell/feedback-progress.tsx`, `src/lib/shared/feedback-eta.ts` |
| Server: router, GitHub-adapter | `src/lib/server/routers/feedback.ts`, `src/lib/server/feedback/` |
| Kontrakt, statusar | `src/lib/shared/feedback.ts` |
| Agentpromptar | `tooling/agents/*.md` |
| Etiketter | `tooling/agents/labels.json`, `tooling/scripts/setup-agent-labels.sh` |
| Agentvakten | `tooling/scripts/agent-guard.ts`, `.github/workflows/agent-guard.yml` |
| Staging-deploy | `tooling/scripts/deploy-latest-tag.sh` (`AVA_DEPLOY_TRACK=main`) |
