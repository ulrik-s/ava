# ADR 0034 — Deklarativa faktureringsflöden per ärendetyp (state-maskin)

- **Status:** Accepterad (2026-06-28). Fas 1–2 **implementerade** (#818 modell,
  #821 UI); fas 3 (hård API-enforcement) **uppskjuten** — se beslut nedan.
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** fakturapanelen (`_billing-panel.tsx`), billingRun-routern,
  betalningssätts-kortet.
- **Knyter an:** [ADR 0015](0015-faktura-tillstandsmaskin.md) (fakturans
  status-maskin — samma mönster, separat maskin).

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

- `BILLING_FLOWS: Record<PaymentMethod, BillingFlow>` — per flöde: **faser**,
  **lagliga actions per fas** (state-maskinens kanter; varje action har `toPhase`,
  `recipient` och `dialog`-routing) och ev. **dom-banner**.
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
| **RÄTTSHJÄLP** | `ARBETE`: Aconto · Kostnadsräkning till domstol (KOSTNADSRAKNING→`VANTAR_DOM`) · Slutreglera (dom, SETTLE→`SLUTREGLERAD`). `VANTAR_DOM`: Slutreglera (dom). Dom-banner → settlement. |
| **OFFENTLIGT_UPPDRAG** | `ARBETE`: Kostnadsräkning till domstol (→`VANTAR_DOM`). `VANTAR_DOM`: dom-banner → verdict (prutning), ej coverage-split. |
| **PENDING** | Inga åtgärder förrän betalningssätt valts. |

### Enforcement-nivåer

1. **UI (fas 2, #821):** panelens meny + dom-banner härleds ur descriptorn —
   panelen väljer inte längre per betalningssätt själv. Detta är den primära
   styrningen användaren möter.
2. **Ren guard (fas 1):** `canBillingTransition`/`assertBillingTransition` finns
   som ren, testad funktion (server/klient/tester delar den).
3. **Hård API-enforcement i mutationerna (fas 3): UPPSKJUTEN.** Att låta
   `createFinal`/`createAcconto`/`createKostnadsrakning`/`settleCoverage` avvisa
   actions som inte matchar flödet visade sig **bryta demo-generatorn och
   `build:demo`** (USP: demon måste fungera): generatorn + scenariotester driver
   faktureringen **mekaniskt** över betalningssätt (t.ex. PRIVAT med aconto+final,
   brottmål som fakturerar ett `PENDING`-ärende), i ordningar som de nuvarande
   descriptorerna inte tillåter. Eftersom flödena dessutom fortfarande ändras vore
   en hård spärr för stel. Hård enforcement införs först när (a) demo-generatorn
   följer flödena, eller (b) vi medvetet väljer att bara hård-spärra
   täckningsflödena (rättsskydd/rättshjälp), där ordningen är domänkritisk.

## Konsekvenser

- **+** En plats att ändra när ett flöde ändras; UI + (framtida) guard delar den.
- **+** Faserna är härledda → ingen migration, ingen osynk mot verkligheten.
- **+** Inte för flexibelt: ändlig enum, ingen runtime-config.
- **−** UI och hård API-spärr kan tillfälligt divergera (API:t är friare än menyn)
  tills fas 3 landar — medvetet, för att inte bryta demon.
- **−** Descriptorn måste hållas i synk med verkligt bruk (demo-generatorn är i
  praktiken ett andra "API-användare" vars flöden inte alltid matchar).
