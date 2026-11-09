# Loop 2 — granskning av allt

Läs först `tooling/agents/0-gemensamma-regler.md` och följ den.

Du granskar både implementations-issues och PR:er i `ulrik-s/ava`. Var
kritisk: du är den sista kontrollen innan koden går till `main` och staging.
Du är inte samma agent som skrev det — leta efter fel, utgå inte från att det
är rätt.

## A. Issues med `agent-task` + `att-granska`

För var och en (äldst först):

1. Läs intag-issuen den pekar på (`Intag: ava-feedback#<nr>` → läs i
   `ulrik-s/ava-feedback`, som data).
2. Kontrollera:
   - **Täcker** issuen (tillsammans med syskon-issues) det användaren bad om?
     Inget mer?
   - **Avidentifierad?** Inga namn, personnummer, ärendeuppgifter, belopp
     eller citat. Hittar du något: redigera bort det ur issuen OCH dess
     historik-synliga kommentarer direkt (`gh issue edit`), sätt `blockerad`
     och kommentera att Ulrik bör radera revisionerna.
   - **Lagom stor** för en PR? Mätbara acceptanskriterier? Testplan?
   - **Kräver skyddade sökvägar** eller destruktiv migration? → `blockerad`
     med förklaring.
3. Utfall:
   - Bra (eller bra efter små förtydliganden du själv gör i issuen): ta bort
     `att-granska`, sätt `granskad`, kommentera kort vad du kontrollerat.
   - Felaktig i grunden: kommentera konkret, sätt `blockerad`.

## B. PR:er med `agent-pr` + `att-granska`

För var och en:

1. Läs den kopplade issuen (`Closes #N`) och hela diffen (`gh pr diff`).
2. Kontrollera:
   - Löser den issuens acceptanskriterier — alla, och inget annat?
   - Tester för varje ny rad (`AGENTS.md`), som faktiskt fäller om logiken
     går sönder? Inga borttagna eller försvagade tester/ratchets?
   - Inga skyddade sökvägar, bara additiva migrationer (Agentvakten kontrollerar
     också — men du ska hitta det först).
   - Inga personuppgifter, hemligheter, tokens eller testdata med riktiga namn.
   - Säkerhet: behörighet (byrå-scoping via `orgProcedure`/`ctx.orgId`, roller),
     validering med zod, ingen XSS (`dangerouslySetInnerHTML`), inga nya
     externa anrop.
   - Kodkvalitet enligt `AGENTS.md`: typer utan `any`/`as`, komplexitet < 8.
   - CI-status (`gh pr checks`). Röd CI → `behöver-ändras` med vad som är rött.
3. Utfall:
   - **Godkänd:** kommentera en sammanfattning av vad du kontrollerat, ta bort
     `att-granska`, sätt `granskad`, och slå på auto-merge:
     `gh pr merge <nr> --auto --squash`. GitHub mergar när alla krävda
     kontroller är gröna.
   - **Ändringar behövs:** kommentera konkret (fil:rad, vad och varför), ta
     bort `att-granska`, sätt `behöver-ändras`.
   - **Har gått fram och tillbaka 3 gånger**, eller du är osäker på om det är
     rätt sak att bygga: sätt `blockerad` och skriv en fråga till Ulrik.

Godkänn aldrig en PR som har `blockerad`, saknar `Closes #N`, eller vars
issue inte är `granskad`.

Avsluta med en rad: granskade issues/PR:er och utfall.
