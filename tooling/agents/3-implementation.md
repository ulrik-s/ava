# Loop 3 — implementation

Läs först `tooling/agents/0-gemensamma-regler.md` och `AGENTS.md` och följ dem.

Gör högst EN ny implementation per körning.

## 0. Taket

Räkna agent-PR:er de senaste 24 timmarna:
`gh pr list -R ulrik-s/ava --state all --label agent-pr --search "created:>=<nu minus 24 h, ISO>" --json number | jq length`.
Är det 10 eller fler: gör bara steg 1 (befintliga PR:er), skapa ingen ny.

## 1. Befintliga PR:er först

PR:er med `agent-pr` och `behöver-ändras` (äldst först, högst en per körning):
INNAN du pushar något: stäng av auto-merge (`gh pr merge <nr> --disable-auto`)
och ta bort `granskad` om den finns — en ändrad PR ska alltid granskas om.
Läs granskningens kommentarer, åtgärda dem på samma branch, kör
`bun run quality:fast` (och `bun run build:demo` för appändringar), pusha,
ta bort `behöver-ändras` och sätt `att-granska`. Kommentera vad du ändrat.

PR:er med `agent-pr` och röd CI som inte redan är `behöver-ändras`:
behandla likadant.

Gjorde du något i steg 1: avsluta körningen.

## 2. En ny issue

Välj den äldsta öppna issuen i `ulrik-s/ava` med `agent-task` + `granskad`
som saknar `pågår` och `blockerad`, och vars `Beror på #N` alla är stängda.
Ingen → avsluta.

1. Sätt `pågår` (ta bort `granskad`).
2. `git fetch origin && git checkout -b agent/<nr>-<kort-slug> origin/main`.
3. Implementera enligt issuens acceptanskriterier och testplan — inget mer.
   Tester för varje ny rad. Additiva migrationer. Inga skyddade sökvägar.
4. Verifiera lokalt: `bun run quality:fast`; för appändringar även
   `bun run build:demo`. Rött → rätta. Går det inte efter rimligt försök:
   se "Fastnar" nedan.
5. Commit (Conventional Commits, svenska, body-rader ≤ 100 tecken), push,
   och skapa PR mot `main`:
   - titel = commit-rubriken,
   - body: vad som ändrats, hur det testats, och `Closes #<nr>`,
   - etiketter `agent-pr` + `att-granska`.
6. Ta bort `pågår` från issuen (PR:en bär tillståndet nu).

Mergea aldrig själv — granskningsloopen slår på auto-merge.

## Fastnar

Oklar issue, kräver skyddad sökväg/destruktiv migration, eller CI går inte att
få grön: kommentera på issuen vad du försökt och vad som behövs, ta bort
`pågår`, sätt `blockerad`. Lämna en ev. halvfärdig branch opushad.

Avsluta med en rad: vad som gjordes (PR-nummer eller "inget att göra").
