# ADR 0012 — Fakturanummerserier: var sin serie vid AVA/Fortnox-samexistens

- **Status:** Accepterad
- **Datum:** 2026-06-13
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** fakturamodulen, fakturanummer (`src/lib/server/routers/invoice.ts`), OCR-referens, Fortnox-/ledger-connectorer (ADR 0011), avprickning (camt.053/054)
- **Issue:** [#262](https://github.com/ulrik-s/ava/issues/262)
- **Relaterat:** [ADR 0011](./0011-pluggbar-ledger-connector.md) (pluggbar ledger-connector + samexistens), [ADR 0007](./0007-kundfordringar-konstaterad-kundforlust.md) (fakturamodell), [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (local-first git-backend), [ADR 0003](./0003-nyckelstrategi-app-genererad-uuidv7.md) (app-genererade nycklar)

## Kontext

ADR 0011 slog fast att **AVA inte äger all fakturering** — en byrå kan köra AVAs
fakturamodul och ett externt system (Fortnox fakturamodul) **samtidigt**. Ett
typiskt scenario: de flesta fakturor ställs ut och prickas av i AVA (betalningar
matchas via camt.053/054 + OCR), medan några fakturor ställs ut av Fortnox som
sköter sin egen avprickning via bankkopplingen.

Då uppstår frågan: **fakturanumren måste komma i följd — vem äger
fakturanummerserien?** Två modeller är tänkbara:

1. **Delad räknare** — ett system (t.ex. Fortnox) äger *det* globala
   löpnumret och AVA hämtar nästa nummer via API innan varje faktura ställs ut.
2. **Var sin serie** — AVA och Fortnox har varsin oberoende, obruten serie i
   skilda namnrum.

Frågan har två dimensioner som måste hållas isär: **(a)** är flera parallella
serier ens *lagligt*, och **(b)** vilken modell passar AVAs arkitektur.

### (a) Laglig grund — flera serier är uttryckligen tillåtet

Verifierat mot primärkälla (ej minne):

- **17 kap. 24 § 2 mervärdesskattelagen (2023:200)** anger vad en fullständig
  faktura ska innehålla. Punkt 2 lyder ordagrant:

  > *"ett löpnummer, baserat på **en eller flera serier**, som ensamt
  > identifierar fakturan"*

  Lagtexten räknar alltså explicit med flera parallella serier. (Samma krav fanns
  tidigare i 11 kap. 8 § 2 i gamla mervärdesskattelagen (1994:200).)

- Kravet är en transponering av **artikel 226.2 i rådets direktiv 2006/112/EG
  (momsdirektivet)** — "a sequential number, based on one or more series, which
  uniquely identifies the invoice". Eftersom fakturainnehållet är
  EU-harmoniserat kan svensk rätt inte vara strängare: flera serier är garanterat
  tillåtet i hela EU.

- **Skatteverkets ställningstagande 2023-06-26, dnr 8-2362095** ("Krav på uppgift
  om löpnummer i en faktura, mervärdesskatt") slår fast att inget hindrar
  säljaren från att använda **flera** löpnummerserier. Det väsentliga villkoret
  är att **varje serie är obruten under hela beskattningsåret** — så att en
  saknad faktura kan upptäckas genom att serien kontrolleras.

Slutsats: **det är lagligt** att AVA och Fortnox har var sin serie, förutsatt att
varje serie är obruten och varje fakturanummer är unikt.

## Beslut

**AVA och ett samexisterande externt system har var sin oberoende
fakturanummerserie. Vi inför aldrig en delad räknare.**

1. **AVA äger sin serie lokalt.** Fakturanummer genereras i `nextInvoiceNumber`
   (`src/lib/server/routers/invoice.ts`) som `F-YYYY-NNNN` per org och år,
   monotont stigande, härlett ur senast utställda numret i samma serie.
   Numret — och därmed OCR-referensen — sätts **utan** att fråga något externt
   system.
2. **Det externa systemet äger sin serie.** Fortnox (eller annat) tilldelar sina
   egna fakturor löpnummer i sin egen serie. AVA varken läser eller skriver det
   numret.
3. **Skilda namnrum garanterar unicitet.** AVAs `F-`-prefixade serie och det
   externa systemets serie kan per konstruktion inte kollidera. Lagens
   unicitetskrav uppfylls utan samordning mellan systemen.
4. **Avprickningen följer serie-ägandet.** En betalning prickas av i det system
   som äger fakturan: AVA matchar OCR härlett ur sin egen serie (ACCONTO/FINAL,
   ej domstols-kostnadsräkningar — se OCR-reglerna), Fortnox prickar av sina egna
   via bankkopplingen. Delas samma camt-fil/bankkonto mellan systemen dyker
   "andra systemets" betalningar upp som *ingen träff* — det hanteras i
   avprickningen (filtrera på egen OCR-serie), inte genom att slå ihop serierna.

### Varför inte en delad räknare

En delad, externt ägd räknare skulle kräva ett **synkront API-anrop vid varje
fakturautställning** för att hämta nästa nummer. Det bryter AVAs bärande
arkitektur:

- **Lokal-först / offline** (ADR 0001, ADR 0003): fakturanummer och OCR måste
  kunna sättas i browsern mot OPFS utan nät. Ett beroende till Fortnox API vid
  utställning gör fakturering omöjlig offline och kopplar domänen till en
  leverantör.
- **Domän-oberoende** (ADR 0011): fakturamodulen får inte importera
  `integrations/*`. Ett delat nummer skulle dra in connector-beroende rakt in i
  numreringskärnan.
- **Robusthet:** en API-tur per faktura inför en extern felkälla och
  latens i ett flöde som idag är rent lokalt och deterministiskt.

Eftersom lagen tillåter flera serier finns ingen anledning att betala det priset.

## Konsekvenser

- **+** Lagligt utan förbehåll (17 kap. 24 § 2 ML / art. 226.2 momsdirektivet /
  SKV dnr 8-2362095) — flera serier är ett uttryckligt tillåtet upplägg.
- **+** Fakturering förblir lokal-först, offline-bar och leverantörsoberoende.
  Inget API-anrop krävs för att tilldela ett nummer.
- **+** Samexistens "bara fungerar": varje system ansvarar för sin egen series
  obrutenhet; ingen delad sanningskälla att synka.
- **−** Användaren ser **två obrutna serier** i sin bokföring, inte en enda
  global följd. Det är lagligt och normalt, men måste kommuniceras (annars kan
  det se ut som "luckor"). Revisorn kontrollerar varje serie för sig.
- **−** Vid **delad camt-fil/bankkonto** blir AVAs avprickningskö brusig av
  Fortnox-betalningar (fel OCR-serie → ingen träff). Mitigeras genom att filtrera
  på egen serie eller hålla bankflödena isär — egen uppföljning, ej låst här.
- **−** AVAs prefix är idag **hårdkodat `F-`** (`nextInvoiceNumber`). Så länge
  det externa systemet inte också använder `F-`+samma år+4 siffror räcker det,
  men om en byrå behöver ett byrå-specifikt prefix/startnummer för att undvika
  visuell förväxling är det en separat, valfri inställning (ej krav från detta
  beslut).

## Alternativ (förkastade)

- **Delad räknare ägd av Fortnox via API** — bryter lokal-först, offline och
  domän-oberoende; inför extern felkälla per faktura. Onödigt eftersom lagen
  tillåter flera serier. Nej.
- **Tvinga all fakturering genom AVA (en enda serie)** — motsäger ADR 0011:s
  samexistens-premiss; byrån vill medvetet köra båda systemen. Nej.
- **Slå ihop serierna i efterhand till en logisk följd** — meningslöst;
  unicitet + obrutenhet *per serie* är allt lagen kräver, och en hopslagning
  skulle bryta båda systemens egna obrutna serier.
