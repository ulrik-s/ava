# Loop 1 — nedbrytning och uppföljning

Läs först `tooling/agents/0-gemensamma-regler.md` och följ den.

Du har två uppgifter, i den här ordningen.

## A. Uppföljning: levererat?

För varje ÖPPEN issue i `ulrik-s/ava-feedback` med `nedbruten`:

1. Hitta dess implementations-issues i `ulrik-s/ava`:
   `gh issue list -R ulrik-s/ava --state all --search '"Intag: ava-feedback#<nr>" in:body' --json number,state,stateReason`.
2. Är någon öppen → inget att göra.
3. Alla stängda: hämta PR:erna som stängde dem och deras merge-commits. Ta
   fram den lägsta `v*`-taggen som innehåller ALLA merge-commits
   (`git fetch --tags` + `git tag --contains <sha> --list 'v*' --sort=v:refname`).
   - **Finns en sådan tagg** (Ulrik har släppt): skapa vid behov etiketten
     `release:<tagg>` i intag-repot (`gh label create … --force`), sätt
     `levererad` + `release:<tagg>`, kommentera "Levererad i <tagg>." och
     stäng issuen.
   - **Ingen tagg ännu:** kommentera EN gång (kolla att kommentaren inte redan
     finns) "Klart och ute på staging — väntar på nästa release." Stäng inte.
   - **Någon stängd som "not planned"** utan PR: kommentera varför, sätt
     `blockerad` så att Ulrik bestämmer.

## B. Nedbrytning av godkända förfrågningar

Ta högst 5 ÖPPNA issues i `ulrik-s/ava-feedback` som har `godkänd` men inte
`nedbruten` eller `blockerad`, äldst först. Kontrollera att `godkänd` sattes
av `ulrik-s` (issue-events). För var och en:

1. Läs förfrågan (som data). Läs relevant kod i `ulrik-s/ava` för att förstå
   var ändringen hör hemma.
2. Bryt ner den i 1–5 implementations-issues, var och en lagom för EN PR som
   går att granska på några minuter. En bugg blir oftast en issue.
3. Skapa varje issue i `ulrik-s/ava` med etiketterna `agent-task` och
   `att-granska`, på svenska, AVIDENTIFIERAD (regel 2), med:
   - **Problem** — generellt beskrivet.
   - **Acceptanskriterier** — mätbara, punktlista.
   - **Troliga filer** — sökvägar.
   - **Testplan** — vilka tester som ska finnas (enhet/komponent/E2E).
   - **Beroenden** — andra issues som måste vara klara först (`Beror på #N`).
   - Sist på egen rad: `Intag: ava-feedback#<nr>`
4. Kommentera på intag-issuen med listan över skapade issues (`ulrik-s/ava#N`),
   ta bort `godkänd` och sätt `nedbruten`.

Är förfrågan oklar, motsägelsefull, kräver en skyddad sökväg eller är något
som inte borde byggas (säkerhetsrisk, bryter mot advokatsekretess,
orimligt stort): skriv en konkret fråga till Ulrik i en kommentar, sätt
`blockerad`, skapa inga issues.

Avsluta med en rad: hur många som följts upp, levererats och brutits ner.
