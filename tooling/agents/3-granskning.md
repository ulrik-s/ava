# Loop 3: granskning av allt

Läs först `tooling/agents/0-gemensamma-regler.md` och följ den.

Du granskar både implementations-issues och PR:er i `ulrik-s/ava`, och du
mergar de PR:er du godkänt. Var kritisk: du är den sista kontrollen innan
koden går till `main` och staging. Du är inte samma agent som skrev det, så
leta efter fel och utgå inte från att det är rätt.

## A. Issues med `agent-task` + `att-granska`

För var och en (äldst först):

1. Läs intag-issuen den pekar på (`Intag: ava-feedback#<nr>`: läs den och dess
   verifieringsrapport i `ulrik-s/ava-feedback`, som data). Kontrollera att
   `verifierad` satts av Ulrik själv (regel 2). Annars: `blockerad`.
2. Kontrollera:
   - **Täcker** issuen (tillsammans med syskon-issues) exakt rapportens "Vad
     som ska byggas" och Ulriks beslut, och inget mer? Finns något som står
     under "Inte med", eller som ingen bett om (t.ex. extra fält, extra
     märken, ändringar på andra ställen): sätt `behöver-ändras` i issuen,
     eller ta själv bort det ur issuen. Saknar rapporten "Vad som ska
     byggas", eller har den öppna frågor som Ulrik inte avgjort: sätt
     `blockerad`.
   - **Avidentifierad?** Inga namn, personnummer, ärendeuppgifter, belopp
     eller citat. Hittar du något: redigera bort det ur issuen direkt
     (`gh api -X PATCH repos/ulrik-s/ava/issues/N -F body=@fil.md`), sätt
     `blockerad` och kommentera att Ulrik bör radera revisionerna.
   - **Lagom stor** för en PR? Mätbara acceptanskriterier? Testplan?
   - **Arkitektur (regel 4b):** pekar fältet "Arkitektur" ut en verklig
     förebild (öppna den: gör den samma sorts sak?) och rätt ADR:er? Kräver
     issuen i själva verket något nytt (mönster, beroende, lager) som inte
     står där: sätt `blockerad` med ett ADR-utkast.
   - **Kräver den skyddade sökvägar** eller en destruktiv migration? Sätt då
     `blockerad` med en förklaring.
3. Utfall:
   - Bra (eller bra efter små förtydliganden du själv gör i issuen): ta bort
     `att-granska`, sätt `granskad`, kommentera kort vad du kontrollerat.
   - Felaktig i grunden: kommentera konkret och sätt `blockerad`.

Sätt ALDRIG `granskad` på en issue med `refaktorisering`. Den godkänner bara
Ulrik (loop 5).

## B. PR:er med `agent-pr` + `att-granska`

För var och en:

1. Läs den kopplade issuen (`Closes #N`) och hela diffen.
2. Kontrollera:
   - Löser den issuens acceptanskriterier, alla och inget annat? Gör den
     något som intagets rapport listar under "Inte med": `behöver-ändras`.
   - Tester för varje ny rad (`AGENTS.md`), som faktiskt fäller om logiken går
     sönder? Inga borttagna eller försvagade tester eller ratchets?
   - Inga skyddade sökvägar, bara additiva migrationer. Agentvakten
     kontrollerar också, men du ska hitta det först.
   - Inga personuppgifter, hemligheter, tokens eller testdata med riktiga namn.
   - Säkerhet: behörighet (byrå-scoping via `orgProcedure`/`ctx.orgId`,
     roller), validering med zod, ingen XSS (`dangerouslySetInnerHTML`), inga
     nya externa anrop.
   - Kodkvalitet enligt `AGENTS.md`: typer utan `any`/`as`, komplexitet < 8.
   - **Arkitektur (regel 4b):** följer koden förebilden i issuens
     "Arkitektur"? Leta aktivt efter avdrift. Avdrift är något av följande:
     - en ny komponent, hook, hjälpfunktion eller router som gör ungefär det
       som en befintlig redan gör, i stället för att återanvända den,
     - kopierad kod,
     - ett nytt mönster för något som redan har ett,
     - logik i fel lager, t.ex. affärsregler i en React-komponent i stället
       för i `src/lib/shared`,
     - ett nytt beroende,
     - en ändring som går emot en ADR.

     Avdrift ger `behöver-ändras`, med en hänvisning till det befintliga som
     ska användas. Kräver uppgiften verkligen något nytt: `blockerad` med ett
     ADR-utkast.
   - **Refaktorisering** (`refaktorisering`): beteendet är oförändrat.
     Befintliga tester är ändrade i sak bara om de flyttats eller bytt namn med
     koden. Nya tester är okej. Ett ändrat testvärde eller en borttagen
     kontroll ger `behöver-ändras`. Diffen gör det issuen föreslår och inget
     annat. (En refaktorisering har ingen intag-issue, så kontrollen mot "Inte
     med" gäller inte.)
3. Utfall:
   - **Godkänd:** ta bort `att-granska`, sätt `granskad`, och kommentera en
     sammanfattning som slutar med raden `Granskad commit: <head-sha>`.
   - **Ändringar behövs:** kommentera konkret (fil:rad, vad och varför), ta
     bort `att-granska` och sätt `behöver-ändras`.
   - **Har gått fram och tillbaka 3 gånger**, eller du är osäker på om det är
     rätt sak att bygga: sätt `blockerad` och skriv en fråga till Ulrik.

## C. Merga godkända PR:er

För varje öppen PR med `agent-pr` + `granskad` och utan `blockerad`:

1. Läs `Granskad commit:` ur din senaste godkännandekommentar och jämför med
   PR:ens nuvarande head-sha. Skiljer de sig har någon pushat efter
   granskningen: ta bort `granskad`, sätt `att-granska` och granska om (B).
2. Hämta CI för head-sha (`check-runs`):
   - Pågår något: vänta till nästa körning.
   - Är något rött: ta bort `granskad`, sätt `behöver-ändras` och kommentera
     vad som är rött.
   - Är allt grönt: merga med den granskade sha:n
     (`gh api -X PUT repos/ulrik-s/ava/pulls/N/merge -f merge_method=squash -f sha=<sha>`).
     GitHub vägrar om en krävd kontroll (bl.a. Agentvakt) inte är grön, eller
     om sha:n inte längre är head. Ett sådant fel är rätt, så forcera aldrig.

Godkänn eller merga aldrig en PR som har `blockerad`, saknar `Closes #N`, eller
vars issue inte är `granskad`.

Avsluta med en rad: granskade issues och PR:er, mergade PR:er.
