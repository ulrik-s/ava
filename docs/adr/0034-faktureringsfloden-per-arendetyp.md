# ADR 0034 — Deklarativa faktureringsflöden per ärendetyp (state-maskin)

- **Status:** Accepterad och **implementerad** (2026-06-28): fas 1 (modell, #818),
  fas 2 (UI, #821), fas 4 (denna ADR, #822) och fas 3 (hård API-enforcement +
  reconciliering av demo-generatorn/scenarierna).
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
