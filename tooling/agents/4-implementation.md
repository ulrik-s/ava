# Loop 4: implementation

Läs först `tooling/agents/0-gemensamma-regler.md` och `AGENTS.md` och följ dem.

Gör högst EN ny implementation per körning. Du mergar aldrig själv:
granskningsloopen mergar.

## 0. Taket

Räkna agent-PR:er de senaste 24 timmarna:
`gh api -X GET search/issues -f q='repo:ulrik-s/ava is:pr label:agent-pr created:>=<nu minus 24 h, ISO>' --jq .total_count`.
Är det 10 eller fler: gör bara steg 1 (befintliga PR:er) och skapa ingen ny.

## 1. Befintliga PR:er först

PR:er med `agent-pr` och `behöver-ändras` (äldst först, högst en per körning):
läs granskningens kommentarer och åtgärda dem på samma branch. Kör
`bun run quality:fast`, och för appändringar även `bun run build:demo`.
Pusha, ta bort `behöver-ändras`, sätt `att-granska` och kommentera vad du
ändrat. Den nya head-sha:n gör att granskningen måste godkänna på nytt innan
något kan mergas.

Gjorde du något i steg 1: avsluta körningen.

## 2. En ny issue

Välj den äldsta öppna issuen i `ulrik-s/ava` med `agent-task` + `granskad`
som saknar `pågår` och `blockerad`, och vars `Beror på #N` alla är stängda.
**Användarnas önskemål går först:** ta en issue med `refaktorisering` bara om
ingen annan finns. En `refaktorisering`-issue är ett förslag från
veckogenomgången (loop 5), och den får du bara bygga om `granskad` sattes av
Ulrik själv. Kontrollera det i händelseloggen, på samma sätt som `verifierad`
i regel 2. Satte en agent den: ta bort den och gå vidare.
Finns ingen: avsluta.

1. Sätt `pågår` och ta bort `granskad`.
2. `git fetch origin && git checkout -b claude/<nr>-<kort-slug> origin/main`
   (prefixet `claude/` krävs i molnet).
3. **Arkitektur först (regel 4b):** läs issuens fält "Arkitektur", förebilden
   och de ADR:er som gäller, och gör likadant som förebilden. Upptäcker du
   att det inte går utan något nytt (mönster, beroende, lager): sluta och
   gör som under "Fastnar", med ett ADR-utkast.
4. Implementera enligt issuens acceptanskriterier och testplan, inget mer.
   Tester för varje ny rad. Additiva migrationer. Inga skyddade sökvägar.
   **Refaktorisering** (`refaktorisering`): beteendet får inte ändras.
   Befintliga tester ändras inte, utom att de flyttas eller byter namn
   tillsammans med koden. De är kontraktet. Behöver ett test ändras i
   sak: stopp, beteendet ändras.
5. Verifiera lokalt med `bun run quality:fast`, och för appändringar även
   `bun run build:demo`. Rött: rätta. Går det inte efter rimligt försök, se
   "Fastnar" nedan.
6. Commit (Conventional Commits, svenska, body-rader ≤ 100 tecken; en
   refaktorisering är `refactor(...)`), push, och skapa PR mot `main` via
   `gh api` (regel 5):
   - titel = commit-rubriken,
   - body: vad som ändrats, vilken förebild du följt, hur det testats, och
     `Closes #<nr>`,
   - sätt sedan etiketterna `agent-pr` + `att-granska` på PR:en, plus
     `refaktorisering` om issuen har den
     (`gh api repos/ulrik-s/ava/issues/<pr-nr>/labels …`).
7. Ta bort `pågår` från issuen. PR:en bär tillståndet nu.

## Fastnar

Är issuen oklar, kräver den en skyddad sökväg eller destruktiv migration,
eller går CI inte att få grön? Kommentera på issuen vad du försökt och vad
som behövs, ta bort `pågår` och sätt `blockerad`. Lämna en eventuell
halvfärdig branch opushad.

Avsluta med en rad: vad som gjordes (PR-nummer eller "inget att göra").
