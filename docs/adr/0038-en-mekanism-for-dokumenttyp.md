# ADR 0038 — En mekanism för dokumenttyp: flera typer per dokument, inga taggar

**Status:** Antagen · **Datum:** 2026-11-17 · **Issue:** #1632 · **Intag:** ava-feedback#15
**Ersätter:** taggarna i #621 · **Bygger på:** [ADR 0017](0017-sync-reconcile-protokoll.md), [ADR 0023](0023-dokument-bytes-content-adresserat.md), [ADR 0037](0037-harda-egen-synkmotor.md)

## Kontext

Frågan "vad är det här för dokument?" besvarades på tre sätt:

| Mekanism | Värden | Läses av |
|---|---|---|
| `documents.document_type` (EN per dokument) | kod ur `KNOWN_KINDS` **eller** fritext: "Kostnadsräkning", "E-post", "Faktura", demodatans "Kallelse"/"Dom" … | filter, kolumner, sökning, **kostnadsräkningens affärslogik** |
| `document_parts.kind` (#1220, per sidintervall) | `KNOWN_KINDS` | sökfiltret; `document_type` = första delens typ |
| `documents.tags` (#621, byråns vokabulär) | fritt, t.ex. Bevisning, Dom, Fullmakt, Kallelse, Kostnadsräkning | **bara** chips på raden — aldrig sök eller filter |

Det har redan glidit isär: "Faktura" (fritext) och `FAKTURA` (kod) blev två
poster i filtret; demodatans fritext klassades aldrig om; taggarna upprepade
typerna; kostnadsräkningar hittades via en visningstext; fritextsökning
matchade råa koder ("STAMNING") och inte "Stämning"; en fritexttyp gick inte
att välja igen efter en ändring. Juristerna vill dessutom kunna sätta **flera
typer** på ett dokument och söka "alla Förordnanden som nämner X"
(ava-feedback#15). Användarna migrerar data till AVA medan detta byggs, så
övergången får inte tappa något och inte kräva stillestånd.

## Beslut

### 1. Ett begrepp: dokumentets typer

Ett dokument har en **ordnad lista typer**, `kinds: string[]`. Första typen är
den primära (den som visas först). Varje värde är antingen

- en **inbyggd typ**: en kod i `KNOWN_KINDS`, som utökas med `FORORDNANDE`
  (Förordnande), `FORELAGGANDE` (Föreläggande), `KOSTNADSRAKNING`
  (Kostnadsräkning) och `EPOST` (E-post), eller
- en **egen typ** för byrån: visningsnamnet självt. Byråns lista över egna
  typer ligger i `organizations.document_kinds` och redigeras under
  Inställningar → Dokumenttyper. Den ersätter taggvokabulären.

Allt som ska bli en typ går genom **en** normalisering (`normalizeKind`): kod,
visningsnamn och kända synonymer ("Stämningsansökan", "Svaromål", "Beslut", …)
blir en inbyggd kod; allt annat **behålls** som egen typ. Inget värde kastas.

### 2. Delar och vem som bestämmer

Delarna (#1220) står kvar och betyder *var i PDF:en* varje typ finns. Så länge
ingen har satt typerna själv (`kinds_manual = false`) är dokumentets typer
**delarnas typer i sidordning**, plus de egna typer som AI:n föreslår ur
byråns lista. När en person, eller systemet som skapade dokumentet
(kostnadsräkning, faktura, e-post), har satt typerna är `kinds_manual = true`
och AI:n rör dem inte längre. Det ersätter "specialvärden skrivs aldrig över"
och `manualKindOf`.

### 3. Taggar avskaffas

`tags` slutar användas. AI:ns taggförslag blir förslag på egna typer, och
befintliga taggar flyttas in bland dokumentets typer.

### 4. Affärsidentitet hänger inte på en visningstext

Kostnadsräkningens dokument identifieras av `billing_run_id`. Äldre, olänkade
dokument känns igen på typen `KOSTNADSRAKNING` (i stället för texten
"Kostnadsräkning").

### 5. Sökning

Typfilter och facetter räknar på typerna. Fritextsökning matchar typernas
**visningsnamn**: söktermen översätts till de typkoder vars namn matchar, och
de matchas mot `kinds` i databasen.

## Övergången (medan användare migrerar data)

Deploy kör migrationerna före omstarten, gamla flikar kan leva en stund, och
köade anrop från gamla flikar körs om av servern med den nya koden (ADR 0037).
Därför:

1. **Additiv migration.** `documents.kinds` (jsonb, `[]`),
   `documents.kinds_manual` (boolean, `false`), `organizations.document_kinds`
   (jsonb, `[]`) och ett GIN-index på `kinds`. `document_type`, `tags` och
   `document_tags` finns kvar under övergången.
2. **En läsregel.** All kod läser typerna via `documentKinds(doc)`: `kinds` om
   de är satta (eller medvetet tömda), annars härledda ur `document_type` +
   `tags`. Det täcker rader skrivna av äldre kod, äldre JSON-data (demo,
   self-hosted) och klientens cache innan den hämtat de uppdaterade raderna.
3. **En skrivregel.** Ny kod skriver typerna via `kindsFields(kinds, manual)`,
   som också sätter `document_type` = primär typ (för gamla läsare) och tömmer
   `tags`.
4. **Äldre indata översätts.** `documentType` i `document.create`,
   `updateMetadata` och `updateDetails`, `document.setTags`,
   `organization.update({ documentTags })` och radpushar utan `kinds` tas emot
   och översätts till typer. Köade anrop från gamla flikar fungerar alltså.
5. **Backfill efter omstart.** När den nya servern startar (då den gamla är
   stoppad) skrivs `kinds` för alla dokument som har `document_type`/`tags`
   men tomma `kinds`, med version + `change_log` så att klienterna hämtar
   raderna (ADR 0017). Den är idempotent och körs vid varje start (hittar då
   bara rader som äldre kod skrivit). Misslyckas den loggas felet och
   läsregeln gäller; servern startar ändå.
6. **Utfasning.** När inga äldre klienter finns kvar (minst 30 dagar och inga
   översatta äldre skrivningar i loggen) tas `document_type`, `tags`,
   `document_tags` och översättningarna bort i en egen PR. Kodsteget har en
   post i solnedgångsregistret (`tooling/config/sunset.json`, sista dag
   2027-01-31): ligger spåren kvar efter den dagen fäller `bun test`.

## Konsekvenser

- En lista, ett filter, en sökning: Förordnande, egna typer och flera typer per
  dokument fungerar överallt där typ redan fungerar.
- Byråns egna typer kan krocka i namn med inbyggda; normaliseringen gör dem då
  till den inbyggda koden.
- Delarna är kvar och fortsätter vara AI:ns källa för automatiska typer.
- Övergången bär kod (läs- och skrivregel, översättningar) som ska bort i
  utfasningen.
