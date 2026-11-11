# Loop 5: veckans arkitekturgenomgång

Läs först `tooling/agents/0-gemensamma-regler.md` (särskilt regel 4b) och
följ den. Läs sedan `docs/architecture.md` och listan över ADR:er i
`docs/adr/`.

Körs en gång i veckan. Ditt jobb är att se om koden driver iväg nu när
användarnas önskemål byggs av agenter, att berätta det för Ulrik, och att
föreslå **högst tre små refaktoriseringar**. Du ändrar ingen kod själv: du
pushar inget, skapar inga brancher och inga PR:er. Du skriver bara issues och
kommentarer i `ulrik-s/ava`. Inget av det här rör användare eller intaget,
och skriv aldrig i `ulrik-s/ava-feedback`.

## 1. Mät

```bash
bun install
bun run duplicates                       # jscpd-rapporten som mätningen läser
```

Hämta förra veckans siffror ur den senaste issuen med etiketten
`arkitektur-rapport` (öppen eller stängd). Siffrorna står i ett block
`<!-- arch-metrics … -->` sist i dess text. Spara dem som `forra.json`
(finns ingen: hoppa över `--previous`), och kör:

```bash
bun tooling/scripts/arch-metrics.ts --previous forra.json --json nu.json > tabeller.md
```

Ändra aldrig mätskriptet (Agentvakten skyddar det). Är något fel i
mätningen: skriv det i rapporten.

## 2. Läs veckans ändringar

Lista PR:er som mergats till `main` de senaste 7 dagarna:
`gh api -X GET search/issues -f q='repo:ulrik-s/ava is:pr is:merged merged:>=<nu minus 7 dagar, ISO>' --jq '.items[] | "\(.number) \(.title)"'`.
Läs diffen för var och en (`gh api repos/ulrik-s/ava/pulls/N -H "Accept: application/vnd.github.diff"`),
särskilt agenternas (`agent-pr`), och hotspot-filerna i tabellen.

Leta efter **avdrift** (regel 4b):

- **Samma sak löst på två sätt:** två komponenter, hookar eller hjälpfunktioner
  som gör nästan samma sak.
- **Kopierad kod**, även när den är under jscpd-tröskeln.
- **Logik i fel lager**, t.ex. affärsregler i React-komponenter i stället för i
  `src/lib/shared`.
- **Filer som växer** (i de största och i hotspots) mot att göra för mycket.
- **Nya mönster eller beroenden** utan ADR, eller kod som går emot en ADR.
- **Det som är friskt**: säg också vad som ser bra ut. En rapport med bara
  problem blir brus.

## 3. Rapporten

Skapa en issue i `ulrik-s/ava` med etiketten `arkitektur-rapport` och rubriken
`Arkitektur vecka <ISO-vecka> (<datum>)`. Text (svenska, `-F body=@rapport.md`,
läs tillbaka, regel 5):

```markdown
## Sammanfattning
2–4 meningar: driver koden iväg, var, och hur allvarligt (ingen / lite / tydligt).

## Siffror
<tabeller.md>

## Avdrift
För varje fynd: vad, var (fil:rad), varför det är avdrift, hur allvarligt.
(Inga fynd: skriv det.)

## Friskt
Vad som ser bra ut i veckans ändringar.

## Förslag
De refaktoriseringar du föreslår (länkar till issues nedan), eller "Inga".

<!-- arch-metrics
<innehållet i nu.json>
-->
```

Stäng förra veckans `arkitektur-rapport`-issue (state_reason `completed`).

## 4. Förslag (högst tre)

Föreslå bara det som minskar verklig avdrift, i fallande nytta. Varje förslag
ska vara:

- **litet:** en PR som går att granska på några minuter,
- **beteendebevarande:** befintliga tester ändras inte, de är kontraktet,
- **förankrat:** i en siffra (hotspot, storlek, duplicering) eller ett
  konkret fynd ovan,
- **inte ett nytt mönster:** kräver det ett, föreslå i stället ett
  ADR-utkast i rapporten och låt Ulrik bestämma.

Skapa varje förslag som en issue i `ulrik-s/ava` med etiketterna `agent-task`
och `refaktorisering`. Sätt INTE `att-granska` eller `granskad`: Ulrik
godkänner refaktoriseringar själv genom att sätta `granskad` (implementationen
kontrollerar att det var han). Issuen ska innehålla:

- **Problem:** fyndet, med siffra eller fil:rad.
- **Förslag:** vad som ska göras, konkret.
- **Arkitektur:** förebilden att följa och de ADR:er som gäller.
- **Acceptanskriterier:** mätbara, inklusive "befintliga tester oförändrade
  och gröna".
- **Troliga filer.**
- Sist, på egen rad: `Arkitekturrapport: #<rapportens nr>`

Ligger förra veckans förslag kvar ogodkända (utan `granskad`), föreslå inte
samma sak igen. Nämn dem i rapporten i stället. Är de äldre än fyra veckor:
stäng dem (state_reason `not_planned`) med en kommentar.

Avsluta med en rad: rapportens nummer, antal fynd och antal förslag.
