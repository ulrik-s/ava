# Loop 6: PR-vakten — alla PR:er gröna och mergade

Läs först `tooling/agents/0-gemensamma-regler.md` och följ den.

Ditt mål: varje öppen PR i `ulrik-s/ava` ska bli **granskad, grön och
mergad**. Du äger CI-hälsan:
- startar om jobb som hänger,
- kör om flaky jobb,
- rättar rött CI och konflikter på `claude/`-brancher,
- granskar PR:er som inte är agent-PR:er (Dependabot, Ulriks egna),
- mergar det som är klart.

Gå igenom alla öppna PR:er som inte är utkast (äldst först):
`gh api "repos/ulrik-s/ava/pulls?state=open&per_page=100"`. Hoppa över PR:er
med `blockerad` (men gå först igenom dem enligt regel 7 i de gemensamma reglerna). Gör för varje PR det **första** steget nedan som gäller, och
gå sedan vidare till nästa PR.

Läs status med REST:
- `gh api repos/ulrik-s/ava/pulls/N`: `head.sha`, `head.ref`, `mergeable`,
  `mergeable_state`.
- `gh api "repos/ulrik-s/ava/commits/<sha>/check-runs?per_page=100"`.
- `gh api "repos/ulrik-s/ava/actions/runs?head_sha=<sha>&per_page=50"`:
  `id`, `status`, `conclusion`, `run_attempt`, `run_started_at`.

## 1. Jobb som hänger (mer än 60 minuter)

En körning med `status` `queued` eller `in_progress` vars `run_started_at`
är mer än 60 minuter gammal hänger. Inget jobb i repot tar så lång tid.
- Avbryt den: `gh api -X POST repos/ulrik-s/ava/actions/runs/<id>/cancel`.
  Nästa körning av PR-vakten ser den som avbruten och kör om den (steg 2).
- Svarar GitHub att körningen redan är klar, eller att den inte kan avbrytas,
  är det en spökkörning. Stäng och öppna då PR:en igen, så startar CI om på
  samma sha. Det är två skrivningar, i två kommandon:
  `gh api -X PATCH repos/ulrik-s/ava/pulls/N -f state=closed` och sedan
  `gh api -X PATCH repos/ulrik-s/ava/pulls/N -f state=open`.

Pågår CI och är yngre än 60 minuter: vänta till nästa körning.

## 2. Rött eller avbrutet CI

En körning med `conclusion` `failure`, `cancelled` eller `timed_out`:

1. **Kör om de fallerade jobben** när `run_attempt` är 1, eller när
   `conclusion` är `cancelled` eller `timed_out` och `run_attempt` är högst 3.
   Då stoppar inte flaky test och avbrutna jobb PR:en:
   `gh api -X POST repos/ulrik-s/ava/actions/runs/<id>/rerun-failed-jobs`.
   Kända flaky jobb är t.ex. *Keep-both konflikt-E2E* och jobb vars runner
   försvann mitt i.
2. **`failure` igen** (`run_attempt` är 2 eller mer): felet är äkta. Läs loggen
   (`gh api repos/ulrik-s/ava/actions/jobs/<job-id>/logs`) och hitta orsaken.
   - **`claude/`-branch:** rätta felet på branchen och följ "Rätta en
     branch" nedan.
   - **Dependabot (`dependabot/`):** kommentera `@dependabot recreate` en
     gång. Har du redan gjort det och det fortfarande är rött: sätt
     `blockerad` och kommentera vad som är rött.
   - **Annan branch (Ulriks egen):** du kan inte pusha dit. Kommentera en gång
     per head-sha vad som är rött och varför, med fil:rad om det går.

Ett äkta fel rättas genom att koden rättas. Lossa aldrig ett test, en
ratchet eller en spärr, och stäng inte av en kontroll.

## 3. Konflikt eller efter `main`

Är `mergeable` `false`, eller `mergeable_state` `dirty` eller `behind`:
- **`claude/`-branch:** merga in `origin/main` (ingen rebase, ingen
  force-push). Lös konflikterna så att båda sidors avsikt finns kvar, och
  följ "Rätta en branch".
- **Dependabot:** kommentera `@dependabot rebase` en gång per dygn.
- **Annan branch:** kommentera en gång att PR:en har konflikt mot `main`.

## 4. Har aldrig fått CI

Finns inga check-runs alls på head-sha:n och PR:en är mer än 30 minuter
gammal:
- **Dependabot:** kommentera `@dependabot recreate` en gång.
- **Annan PR:** stäng och öppna den igen (två kommandon, som i steg 1).

## 5. Granskning av PR:er som inte är agent-PR:er

PR:er med `agent-pr` granskar loop 3. Rör inte deras granskningsetiketter,
utom som "Rätta en branch" säger.

För övriga PR:er, alltså Dependabot och Ulriks egna, utan `granskad`, eller
med `granskad` men där head-sha:n inte är den granskade:
1. Läs hela diffen och PR-beskrivningen.
2. Granska med samma checklista som loop 3, del B
   (`tooling/agents/3-granskning.md`): korrekthet, tester för ny kod,
   säkerhet, inga försvagade tester eller ratchets, personuppgifter,
   arkitektur.
3. För **Dependabot** gäller dessutom:
   - Diffen ändrar bara versioner: `package.json`, lockfiler, och
     SHA-pinnade `uses:`-rader i `.github/workflows/`.
   - Varje `uses:` är fortfarande pinnad till en full commit-SHA, med
     versionskommentar.
   - Ingen ny action eller ett nytt paket som inte fanns förut.
   - Är det en major-version: läs releasenoten
     (https://github.com/<ägare>/<repo>/releases) och kontrollera
     brytande ändringar mot hur repot använder paketet.
4. **Skyddade sökvägar** (regel 4) i en PR som inte är från Dependabot:
   godkänn inte själv. Kräv att `människa-godkänd` är satt av Ulrik
   (kontrollera i händelseloggen som i regel 2). Saknas den: kommentera en
   gång att PR:en väntar på Ulrik.
5. Utfall:
   - **Godkänd:** sätt `granskad`, ta bort `behöver-ändras` om den finns,
     och kommentera en sammanfattning som slutar med raden
     `Granskad commit: <head-sha>`.
   - **Fel:** kommentera konkret (fil:rad, vad och varför) och sätt
     `behöver-ändras`. Är det en Dependabot-PR med brytande ändringar som
     kräver kodändringar: sätt `blockerad` i stället.

## 6. Merga

En PR mergas när allt detta gäller:
- den har `granskad` och inte `blockerad`,
- `Granskad commit:` i den senaste godkännandekommentaren är lika med
  nuvarande head-sha,
- alla check-runs på head-sha:n är klara och `success`, `skipped` eller
  `neutral`,
- `mergeable` är `true`,
- är det en agent-PR gäller även villkoren i loop 3, del C.

Merga med sha:n:
`gh api -X PUT repos/ulrik-s/ava/pulls/N/merge -f merge_method=squash -f sha=<sha>`.
GitHub vägrar om en krävd kontroll inte är grön, eller om sha:n inte längre
är head. Det felet är rätt, så forcera aldrig.

## Rätta en branch

Gäller bara brancher som börjar med `claude/`.

```bash
git fetch origin
git checkout -B <branch> origin/<branch>
git merge origin/main   # vid konflikt
```

1. Rätta orsaken.
2. Kör `bun run quality:fast`, och för appändringar även `bun run build:demo`.
3. Commit enligt Conventional Commits.
4. Pusha: `git push origin HEAD:<branch>`. Aldrig `--force`.
5. Har PR:en `granskad`: ta bort den och sätt `att-granska`. Den nya
   head-sha:n måste granskas om (loop 3 för agent-PR:er, steg 5 här för
   övriga).
6. Kommentera kort vad du ändrat och varför.

Rätta högst **3 brancher per körning**. Resten tar nästa körning.
Har en PR rättats 3 gånger för samma fel utan att bli grön: sätt `blockerad`
och beskriv felet.

## Gränser

- Skapa inga nya PR:er och inga nya brancher. Du rättar bara befintliga.
- Pusha aldrig till `main`. Ingen force-push.
- En skrivning per kommando (regel 5).

Avsluta med en rad per PR: nummer, vad du gjorde (omstart, omkörning,
rättning, granskning, merge, inget) och varför.
