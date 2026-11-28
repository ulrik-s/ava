# ADR 0042 — Dokumentmotorn: Handlebars-mall över ett layoutspråk som `PdfWriter` ritar

**Status:** Antagen, med tillägg 2026-11-28 (#2255, se sist) · **Datum:** 2026-11-28 · **Issue:** #2251 · **Intag:** ava-feedback#153
**Bygger på:** [ADR 0038](0038-en-mekanism-for-dokumenttyp.md) (dokumenttyperna)

## Kontext

Ägarens krav (2026-11-28): hela fakturan ska kunna byggas som en
Handlebars-mall, och "språket" ska byggas ut så att fakturan och kommande
dokument (kostnadsräkning, brev, påminnelser) byggs på samma sätt. Byråerna
ska kunna ändra layout och text i en mall, inte i kod.

Före beslutet fanns två världar:

- **Byråns HTML-mallar** (`render-handlebars.ts`, `TEMPLATE_HELPERS`): full
  Handlebars, men utdata är HTML och "PDF" är webbläsarens utskrift — inte
  deterministisk, ingen kontroll över sidbrytningar.
- **Fakturans PDF** (`render-faktura-pdf.ts`): ritad i kod med pdf-lib. Exakt
  och offline, men varje ändring av text eller layout är en kodändring.
  Kostnadsräkningen (`render-pdf.ts`) är likadan, ovanpå `PdfWriter`.

## Beslut

**Väg 1:** en Handlebars-mall ger en liten, deklarativ **layoutmarkering**
(XML-lik), som tolkas, valideras och ritas av den befintliga `PdfWriter` till en
riktig PDF — i webbläsaren, offline, där fakturan tas fram i dag.

```
mall (.hbs) + partials + vy-modell
   │  Handlebars (strikt läge, appens hjälpfunktioner)     compile-template.ts
   ▼
layoutmarkering  <document><text>…</text><table>…</table></document>
   │  tolk (XML-delmängd) + zod per element                markup-parser.ts, layout-build*.ts
   ▼
typat layoutträd (LayoutDocument)                          layout-ast.ts
   │  flödeslayout: markör, keep, sidbrytning              draw-*.ts, render-document.ts
   ▼
PdfWriter / pdf-lib → PDF-bytes
```

"Språket" = **Handlebars** för logiken (`if`, `each`, hjälpfunktioner,
partials) + **layoutelementen** för formen. Mallen räknar ingenting: alla belopp
och summor kommer färdiga ur vy-modellen (för fakturan `buildFakturaView`, där
öre blir text på ett ställe).

### Elementen

| Element | Attribut | Betydelse |
|---|---|---|
| `<document>` | `size="A4"`, `width`, `height`, `margin`, `margin-top/-right/-bottom/-left`, `font-family="helvetica\|times"`, `title`, `subject` | Roten. `margin-top` = första baslinjen; sidan bryts vid `height − margin-bottom`. |
| `<style>` | `name`, `font`, `size`, `color`, `leading` | Namngiven textstil, refereras med `style="namn"`. |
| `<page-header>` `<page-footer>` | `top`, `pages="all\|first\|rest"` | Ritas på varje sida (enligt `pages`) i marginalen, när sidantalet är känt. |
| `<block>` | `at="window\|top-left\|top-right"`, `x`, `top`, `width` | Fritt placerat, eget flöde, bryter aldrig sidan. |
| `<text>` | `style`, `font="regular\|bold\|italic"`, `size`, `color`, `leading`, `align`, `keep`, `space-before`, `space-after` | Löptext; radbryts inom ramen och fortsätter på nästa sida. |
| `<image>` | `src`, `width`, `height`, `align`, + utrymme | Namngiven bild (`logo`, `sigill` …) inskalad i rutan. |
| `<table>` | stil, `keep-extra`, `repeat-header` | Fasta kolumner. |
| `<col>` | `width` (pt, mm eller `*` = resten), `align`, `wrap` | En kolumn. |
| `<thead>` `<tfoot>` | `keep` | Hålls ihop, radbryts inte. `thead` upprepas efter sidbrytning om `repeat-header` (standard). |
| `<row>` | stil, `keep`, `space-after` | En rad; kroppens rader radbryter `wrap`-kolumnerna och kräver `keep` (annars rader × `leading` + `keep-extra`). |
| `<cell>` | `style`, `font`, `size`, `color`, `align` | En cell per kolumn. |
| `<rule>` | `thickness`, `color`, `style`, + utrymme | Vågrät linje över ramen. |
| `<spacer>` | `height` (får vara negativ) | Flyttar markören. |
| `<page-break>` | — | Ny sida. |

Längder skrivs i pt (`12`, `12pt`) eller mm (`45mm`); färger som `#rrggbb`
eller grånivå `0`–`1`. Markören är **nästa baslinje**: en text ritas på
markören och flyttar den `leading` per rad. Stilar ärvs dokument → tabell → rad
→ cell; den namngivna `style` ligger under elementets egna attribut.

**Hjälpfunktioner:** appens `formatDate`, `formatDateShort`, `formatAmount`,
`formatHours` (samma som HTML-mallarna) plus `upper`, `pageNumber` och
`pageCount`. Sidnumren skrivs som platshållare och ersätts i sidhuvud och sidfot
när sidantalet är känt; i huvudflödet är de ett fel.

**Fönsterkuvert (`at="window"`):** svenska fönsterkuvert med fönstret till
höger (H2: fönstret 40–44 mm från kuvertets överkant, för A4 tvärvikt i C5 eller
trevikt i E65). Adressfältet börjar 45 mm från arkets överkant och 110 mm från
vänsterkanten och är 80 mm brett, så det slutar 20 mm från högerkanten. Byråns
egna kuvert avgör: mät och justera med `x`/`top`.

### Säkerhet och fel

- Mallens värden escapas av Handlebars innan de når tolken — ett värde kan
  aldrig bli ett element. Tolken avkodar entiteterna tillbaka till text.
- Varje element har ett strikt zod-schema: ett okänt element eller attribut, ett
  ogiltigt värde, en odefinierad stil eller en rad med fel antal celler är ett
  `LayoutError` med rad och element. Handlebars körs i strikt läge, så ett fält
  som saknas i kontexten är också ett fel, inte en tom sträng.
- Text normaliseras till WinAnsi (pdf-libs standardteckensnitt) som fakturan
  alltid gjort: typografiska streck och citattecken blir ASCII, okända tecken `?`.

### Standardmallen och partials

`src/lib/shared/documents/templates/faktura.ts` (TS-strängar, så Next och bun
paketerar dem) är fakturans standardmall. De delade partialerna i
`templates/partials.ts` är byggstenar för kommande dokument: `stilar`,
`brevhuvud`, `betalningsuppgifter` och `sidfot`.

### Paritet först

Standardmallen återger fakturan **exakt** som koden ritade den. Golden-testerna
(`test/unit/lib/documents/faktura-golden.test.ts`) jämför ritoperationerna —
varje text med teckensnitt, storlek, färg och position, varje linje och bild, i
ritordning — samt titel, ämne och sidstorlek, för slutfaktura, aconto, kredit,
rådgivning, självrisk med logga och en flersidig specifikation, plus svep över
utläggs- och tidslistor av olika längd för att låsa sidbrytningarna. Golden-
filerna skrevs medan den gamla renderaren fanns och var identisk med den nya;
den gamla ritkoden togs sedan bort. Därför behåller standardmallen fakturans
gamla sidmått (595 × 842 pt) i stället för ISO-A4.

### Sömmen för byråns mallar (fas 2)

Renderaren tar en `DocumentTemplateSource` (`{ template, partials }`).
`renderFakturaPdf(view, source = STANDARD_FAKTURA_TEMPLATE)`: fas 2 laddar
byråns mall ur Mallar-vyn och skickar in den — validering och felmeddelanden
finns redan. Kostnadsräkningen flyttas till samma motor i fas 2 (egen vy-modell,
egen standardmall, samma partials).

### Det backloggen kräver går att uttrycka

- **Brevhuvud och fönsteradress:** `<block at="window">` med mottagarens adress
  och `{{> brevhuvud}}` överst på första sidan.
- **Sidfot på varje sida:** `{{> sidfot}}` (`<page-footer>` med
  `{{pageNumber}}`/`{{pageCount}}`), och `margin-bottom` så att flödet slutar
  ovanför den.
- **Avräkningstabell:** `<table>` med kolumner, `thead` som upprepas,
  summarader i `tfoot` — beloppen färdiga ur vy-modellen.

## Alternativ

- **(a) HTML + CSS till PDF (webbläsarens utskrift eller en headless-motor):**
  välkänt för mallförfattare, men utskriften är inte deterministisk, kräver
  användarens dialog och ger ingen kontroll över sidbrytningar; en headless-
  motor går inte att köra offline i webbläsaren.
- **(b) Ett JSON-schema i stället för markering:** lätt att validera men tungt
  att skriva för hand, och Handlebars-logik i JSON blir svårläst.
- **(c) Ett befintligt PDF-mallbibliotek (pdfmake m.fl.):** nytt stort beroende
  med egen layoutmodell; paritet med dagens faktura blir svår att bevisa och
  `PdfWriter` (som kostnadsräkningen redan använder) blir över.
- **(d) Behålla ritkoden och bara göra texterna konfigurerbara:** löser inte
  kravet att byråerna ska kunna ändra layouten.

## Konsekvenser

- \+ Fakturans layout och text står i en mall; kommande dokument byggs av samma
  element och partials.
- \+ Allt sker fortfarande i webbläsaren, offline, med samma PDF som i dag.
- \+ Fel i en mall ger ett begripligt meddelande med rad, inte en trasig PDF.
- − Ett eget litet språk att underhålla och dokumentera (elementen ovan); det
  hålls medvetet litet och växer bara när ett dokument behöver det.
- − Golden-filerna låser fakturans exakta utseende; en avsiktlig layoutändring
  kräver att de skrivs om (`UPDATE_GOLDEN=1`) och granskas i PR:en.

## Tillägg 2026-11-28 — byråns fakturamall (#2255; intag #149, #150, #151)

Fakturan som byrån får är nu **byråns egen layout**, byggd som mall i motorn:
`templates/faktura-brev.ts` (`FAKTURA_BREV_TEMPLATE`, standard i
`renderFakturaPdf`). Den gamla standardmallen (paritet med koden, 595 × 842)
togs bort — inget använde den längre — och golden-filerna skrevs om för den
nya mallen (`UPDATE_GOLDEN=1`).

### Språket växer med fyra saker

| Tillägg | Var | Betydelse |
|---|---|---|
| `<u>…</u>` | inne i `<text>` | Understruken del. Inga attribut, bara text, ingen nästling; följer radbrytningen (ett streck per rad, 0,12 × storleken under baslinjen, 0,06 × storleken tjockt, minst 0,5 pt, i textens färg). Blanktecken komprimeras över delarnas gränser. |
| `fill="#rrggbb"` / grånivå | `<row>`, `<table>` | Radens bakgrund över hela tabellens bredd; på `<table>` standard för alla rader. Rektangeln börjar 0,72 × radavståndet över baslinjen och är raderna × radavståndet + `space-after` hög, så fyllda rader i följd möts utan glipa. Ritas före texten. |
| `font="sans"` | `<style>`, `<text>`, `<row>`, `<cell>`, `<table>` | Helvetica också i ett Times-dokument (sidfoten). |
| `<image src="seal">` | — | Fakturans andra namngivna bild: byråns sigill (`footerSeal`) bredvid `logo`. Motorn själv känner bara namngivna bilder; namnen sätts av renderaren. |

`<rule thickness="…">` fanns redan (summeringsrutans tjocka linje är 2,2 pt).
Varje tillägg valideras strikt som resten: ett attribut på `<u>`, `<u>` i en
`<cell>` eller utanför `<text>`, ett okänt `font` eller en ogiltig färg i
`fill` är ett `LayoutError` med rad och element.

### Partialerna

`stilar` (nu även `kolumnrubrik` och `sidfot`), `brevhuvud` (loggan centrerad,
byråns namn utan logga, mottagarens namn och postadress i `<block
at="window">`), `betalningsuppgifter` ("FAKTURA NR …", "Ange <u>endast
fakturanummer</u> vid betalning tack!", uppgiftsblocket klient · fakturadag ·
förfallodag · ärendenr · bankgiro, dröjsmålsräntan), `avrakning` (ny:
Avräkning | Underlag | Andel | Belopp) och `sidfot` (linje, sigill, byråns namn,
telefon, webbplats, "Arvoden bankgiro … · VAT nr: … · Godkänd för F-skatt" på
varje sida). Byråns uppgifter kommer ur organisationsinställningarna, aldrig
ur mallen.

### Vy-modellen

`FakturaView` får (bara presentation, inga belopp räknas om):
`recipientLines`, `clientName`, `dueDate`, `payable`, byråns telefon,
webbplats, bankgiro, momsregistreringsnummer (härlett SE + org.nr + 01 med
`vatNumberFromOrgNumber`, samma som kostnadsräkningen) och sigill,
`settlementRows` och `totals` (exkl moms, moms, inkl moms ur fakturans belopp
och verifikatets moms).

**Avräkningstabellen (#151):** nedbrytningens rader (`SettlementRow`) får
`basisOre`, `shareBips` och `role` (`basis` = bygger underlaget, står i
Underlag; `subtotal` = mellansumma, utelämnas). Procenten står inte längre i
etiketten. Tabellens räknade rader summerar exakt till totalen; skiljer några
ören läggs raden "Öresutjämning" till. Nedbrytningar sparade före tillägget
saknar fälten och ritas rad för rad som förut, utan utjämning.

**Skiljetecknet** i sidfoten är mittpunkten " · " (WinAnsi), som
kostnadsräkningens sidfot — byråns tidigare "∽" finns inte i
standardteckensnittens kodning.

**Sidmått:** ISO-A4 (595,28 × 841,89 pt), marginaler 20 mm så att innehållet
slutar där fönsteradressen slutar (20 mm från högerkanten). Första sidans flöde
börjar 215 pt ned (under fönstret, som kostnadsräkningens rubrik).
