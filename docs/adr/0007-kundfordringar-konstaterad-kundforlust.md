# ADR 0007 — Kundfordringar: sammanställning via daterade händelser + konstaterad kundförlust

- **Status:** Accepterad
- **Datum:** 2026-06-09
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** billing/fakturering, `Invoice`/`Payment`-schemas, kundfordrings-rapporter, event-log/projektioner
- **Issue:** [#132](https://github.com/ulrik-s/ava/issues/132)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend bakom `IDataStore`/tRPC), BillingRun-modellen (`BillingRun`/`frozenAt`/prutning som expense-kind)

## Kontext

En advokatbyrå skickar ut fakturor och vill löpande se **vad som fakturerats** kontra **vad som inte kommer att betalas**, för att förstå faktiskt intjänat. Problemet är inte aritmetik utan redovisning, och har två fällor:

1. **Eftersläpning.** Det tar tid att upptäcka att en faktura inte betalas som den ska. En faktura kan betalas sent, **delbetalas**, eller **läggas ner helt** långt efter utställandet.
2. **Räkna en gång.** En "dålig" faktura får räknas med i förlusten **exakt en gång** — varken dubbelt (över perioder/övergångar) eller tappas bort.

"Fakturerat minus obetalt" är dessutom tvetydigt, eftersom "obetalt" är ett rörligt mål. Det döljer fem distinkta poster:

| Post | Källa i modellen idag | Karaktär |
|---|---|---|
| **Fakturerat** (brutto) | `Invoice.amount` (FINAL/STANDARD, positiv) | daterad vid `invoiceDate` |
| **Inbetalt** | Σ `Payment.amount` | daterad vid `paidAt` |
| **Krediterat / nedsatt** | `CREDIT`-faktura (negativ) + prutning | daterad |
| **Konstaterad kundförlust** | status `BAD_DEBT` *(← luckan, se nedan)* | borde vara daterad |
| **Utestående fordran** | resten (öppen) | snapshot |

**Luckan idag:** `BAD_DEBT` är en **status-flagga, inte en daterad händelse med belopp**. Det går därför inte att svara "hur mycket skrev vi av i maj?", inte att skilja *befarad* från *konstaterad* förlust, och "räkna-en-gång"-garantin vilar enbart på att status-övergången är vaktad. Samma sak skiljer `CANCELLED` (annullerad — fakturan skulle aldrig funnits, reverserar intäkt) från `BAD_DEBT` (legitim fordran som inte drivs in, en förlust) — de får inte slås ihop.

### Svensk redovisnings-distinktion

- **Befarad kundförlust** — *misstänkt* obetald (förfallen, gått länge). Reversibel uppskattning.
- **Konstaterad kundförlust** — *bekräftad* (konkurs, nedlagd, uppgiven). Slutgiltig.

Glappet mellan dessa **är** eftersläpningen.

## Beslut

Vi modellerar kundfordringar som **daterade, immutabla händelser** (event-sourced, "väg B") och summerar genom aggregering. Konkret:

1. **Invariant (partition).** Varje faktura-krona ligger alltid i exakt en hink. Detta gäller per faktura och aggregerat, och är den matematiska garantin för "räkna en gång":

   ```
   amount  =  Σ Payment  +  Σ Credit(abs)  +  Σ WriteOff  +  Utestående
   ```

2. **`WriteOff` som egen daterad post** (symmetrisk med `Payment`), inte ett fält på fakturan:
   `invoiceId`, `amount` (öre), `writtenOffAt`, `recordedById`, `reason`. Sanningskällan är posten; `Invoice.status = BAD_DEBT` blir en **härledd projektion** (precis som status redan speglar betalningar). Write-off-beloppet = **återstoden** vid avskrivningstillfället (`amount − betalt − krediterat`) — en delbetald faktura skriver av bara resten.

3. **Endast konstaterad kundförlust.** Vi bokar ingen befarad förlust / reserv. Befarad synliggörs istället via **åldersanalys** (en härledd vy), inte via händelser. (Full IFRS 9-ECL är overkill för en byrå.)

4. **Livstid som primär vy.** Rubriktalet är ett löpande totalsaldo ("allt fram till nu"). Det eliminerar restatement-problematik helt: upptäcks en gammal faktura vara dålig idag, bokas write-offen **idag** och livstids-nettot sjunker idag — rätt, utan dubbelräkning, utan retroaktiv redigering av utställandet.

   > **Ändring 2026-06-09 (#158):** Rapport-panelen `Kundfordringar` följer nu i stället **rapport-perioden**, scopad på fakturor utställda i perioden (`invoiceDate ∈ [from,to]`) — samma nyckel som billed-panelen. Skälet: panelen sitter på en sida med periodväljare, och en livstidsvy bredvid period-paneler var förvirrande för användaren. Per-faktura-partitionen består (betalningar/krediteringar/avskrivningar räknas mot periodens fakturor). Den rena aggregeringen (`computeArBridge`/`computeAging`) är oförändrad; periodfiltret läggs ovanpå via `scopeArToPeriod`.

5. **Vakt för räkna-en-gång.** En `WriteOff` får bara skapas när utestående > 0. Full avskrivning → härledd status `BAD_DEBT` → vidare write-offs avvisas.

6. **Sammanställningen presenteras som två kompletterande vyer:**

   **(a) Kundfordrings-brygga** (waterfall — varje rad en distinkt daterad aggregering):
   ```
   Fakturerat (brutto)                      1 000 000
   − Krediterat / nedsatt (prutning)           −50 000
   = Justerat fakturerat                       950 000
   − Inbetalt                                 −700 000
   = Utestående fordran                        250 000
        varav ej förfallet                      100 000
        varav förfallet                         150 000
   − Konstaterad kundförlust                    −15 000   ← dras av EN gång
   = Netto realiserat (intjänat, ej förlorat)  935 000
   ```

   **(b) Åldersanalys** (gör eftersläpningen synlig *innan* den konstateras):
   ```
   Förfallna fakturor          Belopp
   0–30 dagar                   80 000
   31–60 dagar                  40 000
   61–90 dagar                  20 000
   >90 dagar                    10 000   ← kandidat för avskrivning
   ```

## Konsekvenser

**Positivt**
- "Räkna en gång" garanteras av invarianten + den vaktade engångs-händelsen — en dålig faktura bidrar till förlustraden exakt en gång.
- Eftersläpningen hanteras naturligt: write-offen är daterad till upptäckts­tillfället; livstidsvyn är alltid korrekt-som-av-nu; åldersanalysen visar pipelinen innan den konstateras.
- **Revisionsspår** (när/varför/vem skrev av) följer av att write-offen är en immutabel post.
- **Gratis period-vyer senare** ("förluster under 2026") utan omarkitektur — daterade händelser stödjer vilket fönster som helst.
- Följer befintligt mönster (`Payment`-rader + härledd status) och event-log/projektions-modellen.

**Kostnad / risk**
- Schema-ändring: ny `WriteOff`-post + `writeOffId` i id-schemat + projektion som härleder `BAD_DEBT`. Omfattas av versionsgrinden ([ADR 0004](./0004-schemaversion-och-versionsgrind.md)).
- Migrering av befintliga `BAD_DEBT`-fakturor → en `WriteOff`-post med uppskattat `writtenOffAt` (t.ex. `dueDate` eller senaste mutationsdatum) eftersom historiskt datum saknas.
- Med *endast konstaterad + livstid* skulle själva rubriktalet kunna produceras av en ren snapshot — vi köper event-modellen för **korrekthet, spårbarhet och framtida period-vyer**, inte för att livstidssiffran i sig kräver det. Medvetet val.
- Implementationsnotis (ej i denna ADR): mutationen som skapar `WriteOff` måste emitta via `safeEmit`-`emit`-helpern, annars avvisas hela transaktionen av den read-only event-loggen i git/demo-backenden.

## Alternativ som övervägdes

- **Väg A — bara snapshot (status-driven).** Aggregera nuvarande `status` per faktura. Enklast, "räkna en gång" trivialt. Avvisad: ingen historik ("avskrivet i maj"), inget revisionsspår, kan inte rekonstruera tidigare sammanställningar — otillräckligt för redovisning.
- **Befarad kundförlust / reserv (IFRS 9-ECL-stil).** Boka uppskattad förlust löpande baserat på ålder. Avvisad (för nu): overkill för en byrås behov; åldersanalysen ger synligheten utan bokförings-komplexiteten. Kan adderas senare ovanpå samma event-modell.
- **Per-period som primär vy.** Skulle utnyttja event-modellens restatement-styrka mer. Avvisad som *primär* vy: byrån vill ha löpande totalsaldo; period-vyer blir härledda fönster när de behövs.
- **`writtenOffAt` + `writtenOffAmount` som fält på `Invoice`.** Lättare än egen post. Avvisad: bryter symmetrin med `Payment`, gör fakturan till både utställande- och avskrivnings-aggregat, och försvårar flera/partiella avskrivningar.

## Implementation

Bryts ned i separata issues (ingen produktionskod i denna ADR): `WriteOff`-schema + id + versionsgrind, projektion `BAD_DEBT`-härledning + invariant-validering, migrering av befintliga `BAD_DEBT`, tRPC-router (`writeOff.create` via `safeEmit`), samt rapport-vyerna (brygga + åldersanalys). Issue: [#132](https://github.com/ulrik-s/ava/issues/132).
