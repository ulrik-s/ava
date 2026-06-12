# ADR 0011 — Pluggbar ledger/faktura-connector (Fortnox är en av flera)

- **Status:** Accepterad
- **Datum:** 2026-06-12
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** fakturamodulen, Fortnox-integrationen (#82), server-runtime-connectorer (ADR 0005)
- **Issue:** [#233](https://github.com/ulrik-s/ava/issues/233) (epic)
- **Relaterat:** [ADR 0001](./0001-pluggbar-backend-bakom-idatastore.md) (pluggbar backend), [ADR 0005](./0005-server-som-git-peer.md) (connector/PeerAct), [ADR 0007](./0007-kundfordringar-konstaterad-kundforlust.md) (ledger/write-off), [ADR 0009](./0009-oidc-login-via-servern.md). Ersätter den tidigare Fortnox-specifika design­noten med en generisk port.

## Kontext

Fortnox-integrationen (#82) byggdes Fortnox-först: `buildVoucherFromInvoice`
renderar Fortnox-konton direkt, och fakturamodulen lutade sig mot
Fortnox-specifika antaganden (AVA äger ALL fakturering → push verifikat).

Kunderna säger två saker som bryter de antagandena:
1. **AVA kan inte äga all fakturering** — det finns fakturor som aldrig går
   genom AVA; Fortnox fakturamodul körs parallellt (samexistens).
2. **Man vill kunna köra andra system än Fortnox** (Visma/e-conomic/Bokio,
   eller bara en SIE-fil) — Fortnox ska vara utbytbart.

Det kräver att **fakturamodulen blir självständig** och att Fortnox blir *en*
implementation bakom en port — samma pluggbarhets-filosofi som ADR 0001
(backends) och ADR 0005 (connectorer).

## Beslut

**Inför en `LedgerConnector`-port. Fakturamodulen är systemoberoende och
beroende av PORTEN, aldrig av en connector.**

### Lager
1. **Faktura-domän (ren, systemoberoende).** Äger fakturanummer, PDF,
   domänlogik (rättshjälp/acconto/prutning), betalnings-domän. Producerar en
   **semantisk verifikat-modell mot ROLLER** (kundfordran / intäkt-arvode /
   utgående-moms / utlägg) — INTE hårdkodade kontonummer. Emit:ar
   domänhändelser (`invoiceIssued`, `paymentRecorded`). **Noll** beroende till
   någon bokföringsleverantör. (#235 renodlar detta ur dagens `voucher.ts`.)
2. **`LedgerConnector`-port** (`src/lib/server/integrations/ledger/port.ts`,
   #234): `capabilities()` + systemoberoende DTO:er in. Connectorn driver
   synken som en PeerAct i server-runtime (ADR 0005, #80/#82) — mot porten.
3. **Connectorer** bakom porten: Fortnox (#82), SIE-fil (#236), bankfil/camt
   (#237), framtida Visma/e-conomic/Bokio. Varje connector översätter den
   semantiska modellen till sitt format (roll→kontonummer-mappning, #217, är
   connector-specifik).

### Capability-modell
`LedgerCapabilities = { pushVoucher, pushInvoice, pullPayments, exportSie, … }`.
Olika backends stödjer olika saker:
- Fortnox-voucher: `pushVoucher` (verifikat AVA→Fortnox).
- Fortnox-invoice (gaffel, #237): `pushInvoice` + `pullPayments` (Fortnox äger
  fakturan + bankavprickning; AVA läser `/3/invoicepayments`).
- SIE-fil: `exportSie`.
- Bankfil/camt: `pullPayments` (avprickning utan bokföringssystem, #164).

Capabilities **gat:ar UI:t** (`Bokför i …` kräver pushVoucher/pushInvoice;
`Hämta betalningar` kräver pullPayments) och gör per-leverantörs-stödet
explicit.

### Oberoende enforce:as
En **dep-cruiser-regel** (jfr #85): faktura-domänen (`src/lib/shared` +
billing-routrar) får importera porten men ALDRIG `integrations/*`. Då är
fakturamodulens självständighet bevisbar, inte bara en ambition.

## Konsekvenser

- **+** Fortnox utbytbart; byråer utan Fortnox kan köra SIE-fil eller annat.
- **+** **Samexistens löst:** faktura-domänen vet inget om någon leverantör →
  den är per definition en delmängd av byråns totala fakturering; connectorn
  pushar bara AVA:s egna.
- **+** **"Hämta betalningar"-frågan blir en capability** i stället för ett
  ad-hoc-beslut — Fortnox-voucher saknar den, en bankfil-/Fortnox-invoice-
  connector har den.
- **+** Samma semantiska modell ger gratis SIE + framtida renderare.
- **+** Bevisbart oberoende fakturamodul (dep-cruiser).
- **−** Ett abstraktionslager till + en migrering av #82-koden bakom porten.
  Värt det givet två oberoende kundkrav (utbytbarhet + samexistens).
- **−** Capability-gating i UI:t blir lite mer logik (men ärligare än att anta
  att "Fortnox finns").

## Alternativ (förkastade)

- **Fortnox hårt inbäddat** (nuläget) — bryter mot utbytbarhet + antar att AVA
  äger all fakturering. Nej.
- **Bara SIE-export** — enklast men tappar push/avprickning/live-integration.
  Blir en capability bland flera i stället.
- **En connector per leverantör utan gemensam port** — duplicering + ingen
  bevisbar domän-isolering. Porten + capability-modellen undviker det.
