# ADR 0034 — Deklarativa faktureringsflöden per ärendetyp (state-maskin)

- **Status:** Accepterad och **implementerad** (2026-06-28): fas 1 (modell, #818),
  fas 2 (UI, #821), fas 4 (denna ADR, #822) och fas 3 (hård API-enforcement +
  reconciliering av demo-generatorn/scenarierna).
  **Reviderad 2026-08-12 (#828/#996):** kostnadsräkningens livscykel bröts ut till
  en egen maskin per körning, och dom-bannern togs bort — se
  [Två maskiner](#två-maskiner-fas-per-ärende-status-per-körning).
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** fakturapanelen (`_billing-panel.tsx`), billingRun-routern,
  betalningssätts-kortet.
- **Knyter an:** [ADR 0015](0015-faktura-tillstandsmaskin.md) (fakturans
  status-maskin — samma mönster, separat maskin) och
  `src/lib/shared/kostnadsrakning-flow.ts` (kostnadsräkningens livscykel, #828).

## Kontext

Olika ärendetyper (`paymentMethod`) faktureras på olika sätt, och reglerna
**ändras löpande** allt eftersom mer domänkunskap kommer in (rådgivningstimme ur
rättshjälpsavgiftens bas, rättsskyddets tidsuppdelade självrisk med 6 h-retrotak,
nekat rättsskydd → rättshjälp, kostnadsräkning till domstol vid rättshjälp …).

Före detta ADR låg flödeslogiken **utspridd över ~12 filer** — `optionsFor` i
panelen, banner-routing, `settleCoverage`/`createKostnadsrakning`, payment-method-
kortet m.fl. Varje nytt besked krävde ändring på flera ställen, och det fanns
ingen explicit beskrivning av *vad som får hända när* i ett flöde.

Krav (från Ulrik): flödena ska bli **lite mer konfigurerbara** — men **inte för
flexibla** (ingen generisk regelmotor, inga användardefinierade flöden).

## Beslut

En **enda deklarativ sanningskälla**: `src/lib/shared/billing-flow.ts`.

- `BILLING_FLOWS: Record<PaymentMethod, BillingFlow>` — per flöde: **faser** och
  **lagliga actions per fas** (state-maskinens kanter; varje action har `toPhase`,
  `recipient` och `dialog`-routing).
- **Härledd fas** (`currentPhase`, stateless ur runs + matter): `NEKAD`
  (avslagsdatum) > `VANTAR_DOM` (kostnadsräkning väntar) > `SLUTREGLERAD`
  (utställd slutfaktura, inget väntar) > `ARBETE`. Ingen kolumn, ingen osynk.
- **In-kod-descriptors**: flödena är data i kod — ändra ett block när nytt besked
  kommer. Ändlig enum, ingen runtime/DB-konfiguration. Speglar
  [ADR 0015](0015-faktura-tillstandsmaskin.md):s `canTransition`/`assert`-mönster.
- Minimal `MIX`/`PENDING`.

### Flödena (state-maskinerna)

| paymentMethod | Faser & kanter |
|---|---|
| **PRIVAT / MIX** | `ARBETE`: Faktura till klient (FINAL). Löpande, ingen besluts-/domslivscykel. |
| **RÄTTSSKYDD** | `ARBETE`: Aconto · Faktura till försäkring (FINAL→`SLUTREGLERAD`) · Slutreglera (försäkringsbesked, SETTLE→`SLUTREGLERAD`). `NEKAD` (avslagsdatum satt): inga åtgärder — banner föreslår rättshjälp. |
| **RÄTTSHJÄLP** | `ARBETE`: Aconto · Kostnadsräkning till domstol (KOSTNADSRAKNING→`VANTAR_DOM`) · Slutreglera (dom, SETTLE→`SLUTREGLERAD`). `VANTAR_DOM`: Slutreglera (dom). |
| **OFFENTLIGT_UPPDRAG** | `ARBETE`: Kostnadsräkning till domstol (→`VANTAR_DOM`) · Faktura till klient (återbetalningsskyldighet). `VANTAR_DOM`: klient-FINAL; domstolsfakturan skapas ur KR-maskinen, ej coverage-split. |
| **PENDING** | Inga åtgärder förrän betalningssätt valts. |

### Två maskiner: fas per ärende, status per körning

`VANTAR_DOM` säger att ärendet **väntar** på domstolen — inte hur väntan
avvecklas. Det senare är kostnadsräkningens egen livscykel (#828) och bor i
`kostnadsrakning-flow.ts`, **per billing-run**:

```
INSKICKAD  ──registrera beslut (belopp + ev. prutning)──▶ BESLUTAD
BESLUTAD   ──skapa faktura───────────────────────────────▶ FAKTURERAD
BESLUTAD   ──överklaga (inlaga)──────────────────────────▶ ÖVERKLAGAD
ÖVERKLAGAD ──hovrättens beslut (slutgiltigt)─────────────▶ BESLUTAD → bara faktura
```

Varför två och inte en: **ett ärende kan ha flera kostnadsräkningar**, så
livscykeln kan inte hänga på ärendet. Faserna är dessutom härledda ur runs —
`currentPhase` lämnar `VANTAR_DOM` i samma stund beslutet registreras, alltså
precis när KR-maskinen får sitt intressanta liv. De två maskinerna beskriver
olika ögonblick och går inte att slå ihop.

Gränssnittet följer delningen: panelens **åtgärdsmeny** kommer ur
`BILLING_FLOWS`, panelens **KR-kort** ur `availableKrActions`. Fakturan skapas
i två steg — "Registrera beslut" (belopp + prutning sparas PÅ körningen) och
sedan "Skapa faktura", som läser prutningen därifrån.

**Dom-bannern är borttagen (#996).** `BILLING_FLOWS` bar ett `pendingBanner`-fält
med en knapp ("Ange dom + prutning") som skulle öppna verdict-dialogen direkt ur
väntefasen. Den renderades aldrig av någon komponent, och efter #828 kunde den
inte fungera om den renderades: `setVerdict` tar inget belopp längre. KR-kortet
är den enda vägen.

### Enforcement-nivåer

1. **UI (fas 2, #821):** panelens åtgärdsmeny härleds ur descriptorn — panelen
   väljer inte längre per betalningssätt själv. Detta är den primära styrningen
   användaren möter. KR-kortets knappar kommer på samma sätt ur
   `availableKrActions`.
2. **Ren guard (fas 1):** `canBillingTransition`/`assertBillingTransition` finns
   som ren, testad funktion (server/klient/tester delar den).
3. **Hård API-enforcement i mutationerna (fas 3): IMPLEMENTERAD.**
   `createAcconto`/`createFinal`/`createKostnadsrakning`/`settleCoverage` kör
   `assertFlowAction` som avvisar (BAD_REQUEST) en action som inte är laglig i
   ärendets nuvarande fas — för ALLA betalningssätt. Ett första försök bröt
   demo-generatorn + `build:demo` (USP) eftersom generatorn/scenariotester drev
   faktureringen mekaniskt i ordningar descriptorerna inte tillät. Det löstes genom
   att **reconciliera modellen mot verkligt bruk** i stället för att backa spärren:
   - PRIVAT/MIX vidgades till **aconto + slutfaktura** (löpande räkning).
   - OFFENTLIGT_UPPDRAG vidgades till **kostnadsräkning + klient-FINAL**
     (återbetalningsskyldighet enligt domen).
   - Demo-generatorns rättshjälp-väg gör nu **aconto → kostnadsräkning →
     slutreglering** (ej en otillåten direkt-FINAL till myndigheten).
   - Brottmåls-/rättshjälps-scenarierna sätter `paymentMethod=OFFENTLIGT_UPPDRAG`.

## Konsekvenser

- **+** En plats att ändra när ett flöde ändras; UI + (framtida) guard delar den.
- **+** Faserna är härledda → ingen migration, ingen osynk mot verkligheten.
- **+** Inte för flexibelt: ändlig enum, ingen runtime-config.
- **−** Descriptorn måste hållas i synk med verkligt bruk — demo-generatorn +
  scenariotester är i praktiken ett andra "API-användare", och en hård spärr
  bryter dem direkt om descriptorn är fel/för snäv (vilket är poängen: spärren
  tvingar fram att modellen är korrekt, men varje ny övergång måste läggas till).
- **−** Ett descriptor-fält utan konsument syns inte. `pendingBanner` låg kvar i
  tabellen i månader — med egna enhetstester, utan renderare — och en e2e-spec
  kopierade dessutom dess knapp-etikett till en villkorad gren som därför tyst
  hoppades över vid varje körning (#996). Testerna gröna, ytan död. **Ett fält i
  `BILLING_FLOWS` som ingen komponent läser ska tas bort, inte behållas "tills
  vidare"** — och en test-gren som får hoppas över bevisar ingenting.

## Demodata

Båda maskinerna ska gå att *se*, inte bara nås genom att klicka sig framåt: ett
brottmål vilar i vart och ett av KR-maskinens lägen (#828 steg 6, PR #998), och
`simulate-orchestrate.test.ts` påstår om demons data att alla fyra finns
samtidigt. Undantaget är `beslutSlutgiltigt: true`, som nås i ett steg från det
överklagade ärendet och täcks av e2e i stället.

## Tillägg: taxeärendets yrkande (#1024, #1182)

Kostnadsräkningens **körning** och **dokument** yrkar samma belopp. Servern
räknar `workValueOreAtRun` med samma funktion som dokumentet
(`kostnadsrakningClaimInclVat`, via `valueKrRun`), så beslut och prutning räknas
mot det domstolen fick se. I ett taxeärende (offentligt uppdrag, brottmålstaxan)
består yrkandet av:

- **taxan** för huvudförhandlingen. Den omfattar allt arbete (DVFS 2025:6 5 §),
  och arbetsraderna är därför informativa,
- **tidsspillan utöver den timme som ingår** (6 §). Timmen tas i första hand
  från tid före 08 och efter 18, och resten yrkas på DVFS 2025:4-normerna (samma
  `tidsspillanUtover` som förordnandemålen),
- **advokatberedskapen** per dygn. Den ligger utanför taxan.

Huvudförhandlingens tid och nivå kommer från dialogen och sparas på ärendet
(`taxaHuvudforhandlingMin`, `taxaLevel`, `taxaHufStart`). Utan HUF-tid, eller
över taxans maxgräns (1 §, 8 §), **vägras** inskicket (PRECONDITION_FAILED).
Det är bättre än att yrka ett belopp som inte stämmer. Över maxgränsen räknas
ärendet löpande: avmarkera taxeärende i dialogen.

## Tillägg: dokument, körning och faktura stämmer (#1255)

Egenskapstester (`test/unit/server/billing/property/`) slumpar ärenden per
betalningssätt och kör dem genom routrarna. De kräver att KR-dokumentets
yrkande, körningens lagrade belopp och slutfakturan är samma när domstolen
beviljar det yrkade. Ett fel återskapas med `AVA_BILLING_SEED=<seed>`.
Testerna hittade två avvikelser, som nu är rättade:

- **Löpande räkning i offentligt uppdrag.** Dialogens dokument räknar in
  huvudförhandlingens tid som arbete, men körningen gick normvägen utan den och
  yrkade mindre än dokumentet. Nu räknas körningen med samma funktion och samma
  tid (`valueKrRun`, `kind: "lopande"`), och därmed också utan F-skatt som
  dokumentet.
- **Rättshjälpens slutreglering.** Yrkandet avrundas till hela kronor per rad,
  men slutregleringen räknade om arvodet på öret. Två fel följde av det:
  - fakturorna summerade till några ören från det beviljade, och
  - fullt beviljat bokades som en nedsättning på några ören.

  Nedsättningen mäts nu mot körningens yrkade belopp. Avrundningsresten läggs
  på betalarens arvodesrad (`settleToAward`), så klientens och betalarens
  fakturor tillsammans blir exakt det domstolen beslutat. (Ersatt av
  delningsmodellen i #1438 nedan: beslutet ÄR totalen och betalaren får resten.)

## Hela kronor per rad (#1438)

Fakturor och kostnadsräkningar avrundar varje rad till hela kronor med svensk
öresavrundning (1–49 öre nedåt, 50–99 öre uppåt; negativa belopp speglas).
Summa exkl moms är summan av de avrundade raderna, momsen 25 % av den summan
avrundad till hela kronor, och brutto = netto + moms. Reglerna finns på ett
ställe, `src/lib/shared/whole-kronor.ts`, och används av värderingen
(`billing-work-value`), utläggen (`expense-vat`), delningen klient/betalare
(`coverage-billing`), acontot (`acconto-vat`) och kostnadsräkningen
(`kr-claim`, `kostnadsrakning`). Därmed är det lagrade beloppet, dokumentet,
OCR-beloppet, kundfordran och verifikatet samma tal.

Bara nya fakturor berörs. De bär `amountRounding: "KRONOR"`; en äldre faktura
saknar fältet och avrundades på öret. Dess belopp räknas aldrig om, och dess
specifikation räknas med öresavrundning när dokumentet renderas om.

Belopp som någon annan fastställt tas som de är: domstolens beviljade belopp
och prutning, försäkringsbolagets prutning, tak och lägsta självrisk, och redan
betalda aconton. Har ett sådant belopp ören bär fakturan dem. Ett äldre aconto
med ören som dras av på en ny slutfaktura ger alltså en slutfaktura med ören, och
dess netto/moms-uppdelning kan skilja under en krona från acontots egen —
accepterat (Ulrik, #1438).

### Delningsmodellen: klient och betalare (#1438)

Gäller rättshjälp och rättsskydd, varje delning mellan klient och betalare
(`src/lib/shared/settlement-allocation.ts`):

1. **Totalen räknas en gång, brutto.** Rättshjälp med domstolens beslut: beslutet
   som det är. Annars fakturans uträkning — netto = summan av de avrundade
   raderna, moms = 25 % av nettot i hela kronor, totalen = netto + moms.
2. **Del 1 (klienten)** = andelen × totalen INKL moms, avrundad till hela kronor —
   efter rättsskyddets golv och tak som förut (lägsta självrisk, maxbelopp,
   bolagets prutning, otäckt arbete; beloppen i beslutet är netto och möter
   totalen med 25 % moms). Andelen räknas på totalen inkl moms för både
   rättsskyddets självrisk och rättshjälpsavgiften.
3. **Del 2 (betalaren)** = totalen − del 1. Den räknas aldrig för sig.
4. **Varje faktura** delar sitt brutto per momssats: netto = brutto / 1,25 i hela
   kronor, moms = resten. Momsen är därmed rätt på under en krona på varje
   faktura.

Summan av delarnas brutto är alltid exakt totalen. Delarnas netto och moms var
för sig kan skilja en krona från det odelade — accepterat. Utläggen ingår i
totalen och delas i samma steg, så betalarens utläggsdel är också resten.
Domstolens nedsättning fördelas över alla rader (arvode och utlägg) och byrån bär
skillnaden mot det odelade nettot. Förhandsvisningen i slutregleringsdialogen
(`billingRun.coverageSplit`) räknar med samma funktion.
