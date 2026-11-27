# Loop 4: implementation

Läs först `tooling/agents/0-gemensamma-regler.md` och `AGENTS.md` och följ dem.

Gör högst TRE nya implementationer per körning, en i taget. Du mergar aldrig själv:
granskningsloopen mergar.

## 0. Taket

Räkna agent-PR:er de senaste 24 timmarna som kan mergas: mergade, och öppna
utan `blockerad` (Ulrik, 2026-11-27). En PR som väntar på hans
`människa-godkänd` eller stängts utan merge räknas inte. Två sökningar, lägg
ihop dem (`<T>` = nu minus 24 h, ISO):
`gh api -X GET search/issues -f q='repo:ulrik-s/ava is:pr label:agent-pr is:merged created:>=<T>' --jq .total_count`
och
`gh api -X GET search/issues -f q='repo:ulrik-s/ava is:pr label:agent-pr is:open -label:blockerad created:>=<T>' --jq .total_count`.
Är summan 30 eller mer: gör bara steg 1 (befintliga PR:er) och skapa ingen ny.

## 1. Befintliga PR:er först

PR:er med `agent-pr` och `behöver-ändras` (äldst först, högst en per körning):
läs granskningens kommentarer och åtgärda dem på samma branch. Kör
`bun run quality:fast`, och för appändringar även `bun run build:demo`.
Pusha, sätt `att-granska` (flödesvakten tar bort `behöver-ändras`) och
kommentera vad du ändrat. Den nya head-sha:n gör att granskningen måste godkänna på nytt innan
något kan mergas.

Gjorde du något i steg 1: gör högst två nya issues (steg 2) i samma körning.

## 2. Nya issues (högst tre, en i taget)

**Användarnas krav först (Ulrik, 2026-11-25).** Hämta EN gång per körning
numren på användarnas öppna förfrågningar i intaget:

```bash
gh api "repos/ulrik-s/ava-feedback/issues?labels=user-request&state=open&per_page=100" --jq '[.[] | select(.pull_request | not) | .number]'
```

En issue räknas som **användarens** när raden `Intag: ava-feedback#N` pekar på
ett av de numren, eller när en sådan issue väntar på den (`Beror på #N` eller
GitHub-beroende): grunden byggs före det som står på den. Alla användarens
issues går före alla andra (interna förbättringar, `intern`-förfrågningar,
refaktoriseringar). Inom varje grupp gäller ordningen nedan.

Välj den öppna issuen i `ulrik-s/ava` med högst prioritet, och den äldsta
inom samma prioritet. Prioriteten är `prio-*`-flaggan: den effektiva, som
klockan sätter (den egna, eller den högsta bland det som väntar på issuen,
så att en grund byggs före det som står på den). Saknas flaggan gäller raden
`Prioritet:`, och saknas båda räknas den som medel. Issuen ska ha
`agent-task` + `granskad`, sakna `pågår` och `blockerad`, inte ha några öppna
GitHub-beroenden
(`gh api "repos/ulrik-s/ava/issues/<nr>/dependencies/blocked_by" --jq '[.[] | select(.state == "open")] | length'`
är 0), och alla dess `Beror på #N` ska vara **klara**:
stängda av en mergad PR (`state_reason` `completed`). Är ett beroende stängt
utan att ha byggts (`not_planned`, och ingen mergad PR i tidslinjen) finns
koden inte på `main`: bygg inte. Sätt `blockerad` och kommentera vilket
beroende som föll bort, så att Ulrik avgör om issuen ska byggas ändå. Ulriks
egna dubbletter (hans kommentar säger det) räknas inte som beroenden.
**Användarnas önskemål går först:** ta en issue med `refaktorisering` bara om
ingen annan finns. En `refaktorisering`-issue är ett förslag från
veckogenomgången (loop 5), och den får du bara bygga om `granskad` sattes av
Ulrik själv. Kontrollera det i händelseloggen, på samma sätt som `verifierad`
i regel 2. Satte en agent den: ta bort den och gå vidare.
Finns ingen: avsluta.

1. **Ta issuen.** Två körningar kan välja samma issue samtidigt, eftersom
   klockans knuff och rutinens schema startar körningar utan flödesvaktens
   lås (#1681). Finns redan en öppen PR med `Closes #<nr>`
   (`gh api -X GET search/issues -f q='repo:ulrik-s/ava is:pr is:open "Closes #<nr>"' --jq .total_count`
   är större än 0): välj nästa issue. Annars tar du issuen med en push.
   Branchnamnet räknas fram ur den senaste `granskad`-händelsen, så alla
   körningar får samma namn, och git släpper bara in den första pushen:
   1. Id:t för den senaste `granskad`-händelsen (nedan `<G>`):
      `gh api "repos/ulrik-s/ava/issues/<nr>/events?per_page=100" --paginate --jq '.[] | select(.event == "labeled" and .label.name == "granskad") | .id' | tail -1`
   2. `git fetch origin && git checkout -b claude/<nr>-g<G> origin/main`
   3. `git commit --allow-empty -m "chore: tar #<nr> (<tal>)"`, där `<tal>` är
      ditt eget slumptal (läs t.ex. `date +%s%N` först och skriv in värdet),
      så att två körningar aldrig får samma commit.
   4. `git push origin HEAD:claude/<nr>-g<G>`

   Avvisas pushen har en annan körning issuen. Rör då inga etiketter, gå
   tillbaka till `origin/main` och välj nästa issue. Den räknas inte som en
   av dina tre. Den tomma commiten försvinner när PR:en squash-mergas.
2. Sätt `pågår` och ta bort `granskad`. Allt arbete för issuen görs på
   `claude/<nr>-g<G>` (prefixet `claude/` krävs i molnet).
3. **Arkitektur först (regel 4b):** läs issuens fält "Arkitektur", förebilden
   och de ADR:er som gäller, och gör likadant som förebilden. Upptäcker du
   att det inte går utan något nytt (mönster, beroende, lager): sluta och
   gör som under "Fastnar", med ett ADR-utkast.
   **Leta innan du skriver (kvalitetsgenomgången 2026-11-26).** Det vanligaste
   felet i agenternas PR:er är en regel som redan finns och skrivs om: momsen
   räknades olika på verifikat och faktura (#1820), arvodesformeln stod på
   tolv ställen (#2174). Innan du skriver en domänregel, en beräkning (belopp,
   moms, tid, datum, status) eller en hjälpfunktion: sök efter den med `git grep`
   på formeln, domänordet och fältnamnet, i `src/lib/shared`, `src/lib/server`
   och `src/lib/client`. Finns den: använd den. Gör den nästan rätt: utöka
   den, skriv inte en till. Skriv i PR:en vad du återanvände (steg 6).
4. Implementera enligt issuens acceptanskriterier och testplan, inget mer.
   Tester för varje ny rad. Additiva migrationer, med `-- kind: expand` på
   första raden (förra versionens kod ska klara schemat, så att deployen kan
   backa servern automatiskt; se docs/deploy-server-first.md, "Migrationer:
   expand och contract"). Inga skyddade sökvägar.
   **Refaktorisering** (`refaktorisering`): beteendet får inte ändras.
   Befintliga tester ändras inte, utom att de flyttas eller byter namn
   tillsammans med koden. De är kontraktet. Behöver ett test ändras i
   sak: stopp, beteendet ändras.
   **Regelförslag** (`refaktorisering` som gäller
   `tooling/config/dependency-cruiser.cjs`): ändra bara den filen, med den
   föreslagna regeln, och kör `bun run deps:check`. Är något i koden fel
   mot regeln: stopp, det är ett fynd för Ulrik och inget du rättar. Skriv
   i PR:en att den rör en skyddad sökväg och väntar på Ulriks
   `människa-godkänd` (Agentvakten är röd tills dess).
5. Verifiera lokalt med `bun run quality:fast`, och för appändringar även
   `bun run build:demo`. Rött: rätta. Går det inte efter rimligt försök, se
   "Fastnar" nedan.

   **Filstorleksspärren** (`bun run file-size`, ingår i `quality:fast`):
   ingen produktionsfil får gå över 400 rader, och filerna i baslinjen
   (`tooling/config/file-size-baseline.json`) får inte växa.
   - Skulle din ändring göra det: dela upp filen efter förebilden, t.ex. bryt
     ut en komponent, hook eller hjälpfunktion till en egen fil. Höj aldrig
     baslinjen.
   - Har du krympt en fil i baslinjen säger spärren att baslinjen är för
     generös. Kör då `bun run file-size --update`, som bara kan skärpa, och ta
     med ändringen i PR:en. Agentvakten tillåter just den ändringen.
   - Routrarna (`src/lib/server/routers/`) har ett lägre tak, 250 rader
     (`tooling/config/router-size-baseline.json`, samma regler). Lägg
     domänlogik i en tjänst under `src/lib/server/<domän>/` som tar repona
     explicit, inte i routern.
6. Commit (Conventional Commits, svenska, body-rader ≤ 100 tecken; en
   refaktorisering är `refactor(...)`). Rubriken efter `typ(scope): ` börjar
   med **gemen** ("fix(reports): exportera …", inte "Exportera") och är högst
   100 tecken. **Kontrollera varje commit innan du pushar** (#2027), för git-
   hooken som gör det lokalt finns inte i molnet:
   `git log --format=%B -n 1 <sha> | bunx commitlint --config tooling/config/commitlint.config.mjs`.
   Rött: skriv om meddelandet med `git commit --amend` innan push. Efter push
   går det inte (force-push är förbjudet) och PR:en fastnar på CI-kontrollen
   "Commit messages". Push sedan, och skapa PR mot `main` via `gh api` (regel 5):
   - titel = commit-rubriken,
   - body: vad som ändrats, vilken förebild du följt, hur det testats, och
     `Closes #<nr>`,
   - en egen rad `**Återanvänt:** <befintliga regler och hjälpfunktioner du
     använt, med sökväg>` (steg 3, "Leta innan du skriver"). Skrev du ny
     domänlogik: skriv vad du sökte efter och att inget fanns,
   - och en egen rad `**För användarna:** <en mening>` ("Nytt i AVA", #2010).
     Meningen visas för juristerna i AVA när releasen kommer: vardaglig
     svenska, vad de märker ("Dokumentlistan visar inte längre kolumnen
     Storlek."), ingen kod, inga filnamn och inget ur förfrågningarna
     (regel 3). Märker användarna ingenting (tester, intern städning, CI):
     skriv `**För användarna:** —`.
   - sätt sedan etiketterna `agent-pr` + `att-granska` på PR:en, plus
     `refaktorisering` om issuen har den
     (`gh api repos/ulrik-s/ava/issues/<pr-nr>/labels …`).
7. Låt `pågår` ligga kvar på issuen: den stängs när PR:en mergas
   (`Closes #N`). Har ingen PR öppnats inom 4 timmar lägger flödesvakten
   tillbaka issuen i kön (`granskad`).
8. Räkna taket igen (steg 0) och välj nästa issue enligt samma regler. Börja
   om från steg 1 (en ny branch från `origin/main`), och ta aldrig en issue som
   `Beror på` en issue du byggt i samma körning: den är inte mergad än.
   Sluta efter tre PR:er, när taket är nått, eller när inget mer finns.

## Fastnar

Är issuen oklar, kräver den en destruktiv migration, eller går CI inte att
få grön? (En skyddad sökväg som arbetsordern beskriver bygger du: regel 4.) Kommentera på issuen vad du försökt och vad
som behövs, ta bort `pågår` och sätt `blockerad`. Pusha inte det
halvfärdiga: branchen ska bara ha commiten som tog issuen.

Avsluta med en rad: vad som gjordes (PR-nummer eller "inget att göra").
