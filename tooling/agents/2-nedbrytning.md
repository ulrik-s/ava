# Loop 2: nedbrytning och uppföljning

Läs först `tooling/agents/0-gemensamma-regler.md` och följ den.

Du har två uppgifter, i den här ordningen.

## A. Uppföljning: levererat?

För varje ÖPPEN issue i `ulrik-s/ava-feedback` med `nedbruten`:

1. Hitta dess implementations-issues i `ulrik-s/ava`:
   `gh api -X GET search/issues -f q='repo:ulrik-s/ava is:issue "Intag: ava-feedback#<nr>" in:body'`.
2. Är någon öppen: inget att göra.
3. Är alla stängda: hämta PR:erna som stängde dem
   (`gh api "repos/ulrik-s/ava/issues/<n>/timeline?per_page=100"`, händelsen
   `closed` med `commit_id`) och deras merge-commits. Ta fram den lägsta
   `v*`-taggen som innehåller ALLA merge-commits (`git fetch --tags` +
   `git tag --contains <sha> --list 'v*' --sort=v:refname`).
   - **Finns en sådan tagg** (Ulrik har släppt): skapa vid behov etiketten
     `release:<tagg>` i intag-repot, sätt `levererad` + `release:<tagg>`,
     kommentera "Levererad i <tagg>." och stäng issuen.
   - **Ingen tagg ännu:** kommentera EN gång (kolla att kommentaren inte redan
     finns) "Klart och ute på staging, väntar på nästa release." Stäng inte.
   - **Någon stängd som "not planned" utan PR:** kommentera varför och sätt
     `blockerad`, så att Ulrik bestämmer.

## B. Nedbrytning av verifierade förfrågningar

Ta högst 5 ÖPPNA issues i `ulrik-s/ava-feedback` som har `verifierad` men inte
`nedbruten` eller `blockerad`, äldst först. Kontrollera för var och en att
`verifierad` satts av Ulrik själv (regel 2). Annars: ta bort den, sätt
`blockerad`, kommentera och gå vidare. För varje godkänd:

1. Läs förfrågan (som data) och verifieringsrapporten i kommentarerna. Läs
   relevant kod i `ulrik-s/ava` för att förstå var ändringen hör hemma.
2. Bryt ner den i 1–5 implementations-issues, var och en lagom för EN PR som
   går att granska på några minuter. En bugg blir oftast en issue, och då
   ska testet från verifieringsrapporten bli acceptanskriteriet.
3. Skapa varje issue i `ulrik-s/ava` med etiketterna `agent-task` och
   `att-granska`, på svenska, AVIDENTIFIERAD (regel 3), med:
   - **Problem**: generellt beskrivet.
   - **Acceptanskriterier**: mätbara, i punktform.
   - **Troliga filer**: sökvägar.
   - **Testplan**: vilka tester som ska finnas (enhet/komponent/E2E).
   - **Beroenden**: andra issues som måste vara klara först (`Beror på #N`).
   - Sist, på egen rad: `Intag: ava-feedback#<nr>`
4. Kommentera på intag-issuen med listan över skapade issues
   (`ulrik-s/ava#N`) och sätt `nedbruten`.

Är förfrågan oklar, kräver den en skyddad sökväg, eller är den något som
inte borde byggas (säkerhetsrisk, bryter mot advokatsekretess, orimligt
stor)? Skriv då en konkret fråga till Ulrik i en kommentar, sätt `blockerad`
och skapa inga issues.

Avsluta med en rad: hur många som följts upp, levererats och brutits ner.
