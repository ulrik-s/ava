# Spike #164 — betalnings-avprickning: Fortnox Invoice Payments vs Bankgiro/camt

- **Status:** Avslutad — beslut fattat **och implementerat**
- **Datum:** 2026-06-13 (research 2026-06-09/06-10)
- **Fråga:** Hur prickar AVA av inkomna kundbetalningar mot sina egna fakturor
  med minimal infra och bibehållen tunn-server-USP?
- **Relaterat:** ADR 0007 (recordPayment / partition-invariant), ADR 0011
  (pluggbar ledger-connector), #181, #237, #245.

## Sammanfattning (TL;DR)

**Fortnox Invoice Payments avfärdades. Vald väg = vendor-neutral bankfil
(ISO 20022 camt.053/054) + OCR-match i AVA — och den är redan byggd.** Ingen
bankuppkoppling, ingen PSD2/AISP-licens, ingen tredjeparts-infra.

## Vad som undersöktes

Spiken utgick (titel) från Bankgiro Inbetalningar / camt.054, men brödtexten
pekade också på **Fortnox Invoice Payments** (`GET /3/invoicepayments`,
scope `payment`) som en möjlig inbound-väg (Fortnox→AVA). Båda utvärderades.

### Fortnox Invoice Payments — AVFÄRDAD

Fortnox dokumentation bekräftar: en "invoice payment" är ett **barn till en
faktura som ligger i Fortnox** (report-payment "assumes invoices already
exist"). Fortnox har ingen bank-scope och inget API för råa, fristående
banktransaktioner.

→ Att läsa Invoice Payments förutsätter alltså att AVA **speglar in fakturan i
Fortnox via Invoice API** — exakt den **dubbla fakturanummerserien** som redan
avfärdats i Fortnox-designen (AVA äger fakturanummer + PDF + domänlogik;
Fortnox används bara som ledger via Voucher API, push AVA→Fortnox). En tidigare
deep-research-slutsats ("AVA läser Invoice Payments") missade detta beroende.

### Bank-direkt (PSD2 / SEB open banking) — AVFÄRDAD

AVA som tredje part mot bankernas PSD2-API:er kräver egen **AISP/TPP-licens** →
dealbreaker för en liten byrå-produkt. (Aggregator som Tink/Klarna Kosma
återinför tredjeparts-beroende + kostnad — noterat men ej valt.)

> Viktig distinktion: bankens **camt-FILtjänst** (cash management-rapportering
> på byråns eget konto, byråns egen bank-överenskommelse) är **inte** PSD2 och
> kräver **ingen** AISP — AVA är bara "affärssystemet som läser filen".

### Bankgiro/camt-fil + OCR — VALD

1. AVA genererar OCR-referens (mod-10) per faktura (kräver byråns
   OCR-/Bankgiro-avtal — OCR-kontroll sker hos Bankgirot, inte banken).
2. Kund betalar med OCR.
3. Byråns bank/Bankgirot levererar en återrapporteringsfil
   (**ISO 20022 camt.053/054**; BGMAX kan adderas som andra parser senare).
4. AVA parsar filen och prickar av **själv**: OCR → AVA-faktura → `recordPayment`
   (ADR 0007-partitionen). Fortnox är inte inblandat i avprickningen.

Fördelar: ingen dubblerad fakturering (AVA = source of truth), ingen PSD2/AISP,
tunn server (EN ISO20022-parser oavsett bank — bara leveranskanal skiljer).

## Beslut

**Bygg INTE en Fortnox-inbound-avprickning.** Prickning sker via bankfil
(camt.053/054) + OCR, bakom den vendor-neutrala ledger-porten (ADR 0011). Fortnox
roll förblir **ortogonal**: bokföring nedströms via Voucher API (verifikat
AVA→Fortnox), aldrig avprickningskälla.

## Implementeringsstatus (redan levererad)

| Del | Fil | Issue |
|---|---|---|
| camt.053/054-parser | `src/lib/shared/payments/camt-parse.ts` | #181 |
| Rik matchning (flera ref/delbelopp/fri text) | `src/lib/shared/payments/match-payments.ts` | #181 |
| Manuell import-/granskningssida | `src/app/payments/import/page.tsx` | #181 |
| `BankFileLedgerConnector` (`pullPayments`) | `src/lib/server/integrations/ledger/bank-file-connector.ts` | #237 |
| Flat OCR-avprickning (idempotent) | `src/lib/server/integrations/ledger/reconcile-payments.ts` | #245 |
| Server-runtime-peer (camt-inkorg) | `src/lib/server/integrations/ledger/bank-file-runtime.ts` | #245 |

Den **rika** matchningen (manuell import) och den **flata** OCR-vägen (automatisk
peer) samexisterar avsiktligt: rik motor för människo-granskning, flat väg för
obevakade källor.

## Öppna frågor — utfall

- *Triggas Fortnox revenue-cut för self-hosted API-konsument?* — **Inte
  längre relevant**: Fortnox används inte för avprickning.
- *Exponerar Fortnox Bankkoppling matchade betalningar via API?* — Irrelevant av
  samma skäl (kräver ändå faktura i Fortnox).
- *Domstols-/fri-text-betalningar utan OCR (Domstolsverket)* — egen uppföljning
  i **#175** (fri-text-match på camt `RmtInf/Ustrd`) + **#173** (fordran utan
  faktura). Utanför denna spike.
