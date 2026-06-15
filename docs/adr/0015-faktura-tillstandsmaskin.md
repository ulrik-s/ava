# ADR 0015 — Fakturornas tillståndsmaskin (explicita övergångar + vakter)

- **Status:** Accepterad
- **Datum:** 2026-06-15
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** billing/fakturering, `invoice`-routern, `paymentPlan`-routern, demo-seed
- **Issue:** [#350](https://github.com/ulrik-s/ava/issues/350)
- **Relaterat:** [ADR 0007](./0007-kundfordringar-konstaterad-kundforlust.md) (kundfordringar/write-off — status härleds ur ledgern), #178 (`InvoiceDispatch`)

## Kontext

Fakturans `status` var ett **fritt muterbart enum-fält utan övergångs-vakter**.
Olika kodvägar (`setStatus`, `recordPayment`, `createPaymentPlan`,
`cancelPaymentPlan`, kreditering, `writeOff`) satte det oberoende av varandra.
Det gjorde att **ologiska kombinationer kunde uppstå** — framför allt en faktura
som blev `PAID` utan att någonsin ha varit `SENT` (`recordPayment` auto-satte
`PAID` även på en `DRAFT`), eller en `DRAFT` med registrerad betalning.

Statusarna (`enums.ts`): `DRAFT · SENT · PAID · CANCELLED · BAD_DEBT ·
INSTALLMENT_PLAN`.

## Beslut

En **explicit tillståndsmaskin** i `src/lib/shared/invoice-state-machine.ts`
(ren logik, delas av server + tester) är EN sanningskälla för tillåtna
övergångar. Alla status-skrivande kodvägar går igenom `canTransition(from, to)`
/ `assertInvoiceTransition(from, to)`.

### Tillstånd + övergångar

```
DRAFT ──(skicka)──▶ SENT ──(full betalning)─────▶ PAID
  │                  │  ├─(delbetalning + plan)──▶ INSTALLMENT_PLAN ──(slutbetald)─▶ PAID
  │                  │  │                                │
  │                  │  │                                ├─(avbruten plan)─▶ SENT
  │                  ├──┴─(avskrivning)────────────────▶ BAD_DEBT
  └─(annullera)─────▶ CANCELLED ◀─(kreditera/annullera)─ * (alla icke-terminala)
```

| Från | Tillåtna till |
|------|---------------|
| `DRAFT` | `SENT`, `CANCELLED` |
| `SENT` | `PAID`, `INSTALLMENT_PLAN`, `BAD_DEBT`, `CANCELLED` |
| `INSTALLMENT_PLAN` | `PAID`, `SENT`, `BAD_DEBT`, `CANCELLED` |
| `PAID` | `CANCELLED` (kreditering) |
| `BAD_DEBT` | `PAID` (sen inbetalning, ledger-härlett), `CANCELLED` |
| `CANCELLED` | — (terminalt) |

`from === to` är alltid en tillåten no-op (idempotens).

### Invarianter

1. **`PAID`/`INSTALLMENT_PLAN`/`BAD_DEBT` nås bara via `SENT`** (eller via
   varandra) — aldrig direkt från `DRAFT`.
2. **`recordPayment` på en `DRAFT` auto-skickar fakturan** (`DRAFT → SENT`)
   innan betalningen registreras — så att `PAID` aldrig uppstår utan att ha
   passerat `SENT`. En `CANCELLED`-faktura kan aldrig betalas (avvisas).
3. **`CREDIT`-fakturor** skapas direkt i `SENT` ("färdig"); originalet går
   `* → CANCELLED`.
4. **Härledda tillstånd** (`PAID`/`BAD_DEBT`) fortsätter härledas ur ledgern
   via `deriveInvoiceStatus` (ADR 0007) — tillståndsmaskinen vaktar de
   *manuella* övergångarna (`setStatus`), ledgern de *händelse-drivna*.

### Per fakturatyp

`STANDARD`/`ACCONTO`/`FINAL` skapas som `DRAFT`. `CREDIT` skapas som `SENT`.
Maskinen är gemensam — typen styr bara starttillståndet.

## Konsekvenser

- `setStatus` + `recordPayment` avvisar omöjliga övergångar med `BAD_REQUEST`
  (tester bevisar att de avvisas).
- Demo-seed genererar bara giltiga, ledger-koherenta tillstånd (PAID-fakturor är
  betalnings-täckta; inga betalningar på `DRAFT`/`CANCELLED`).
- `SENT` backas ännu inte tvingande av en `InvoiceDispatch`-händelse (#178) —
  maskinen tillåter `DRAFT → SENT` via `setStatus`/dispatch. Att knyta `SENT`
  hårt till en dispatch-post lämnas som uppföljning.

## Alternativ som övervägdes

- **Enbart ledger-härledning (ingen maskin).** Räcker för `PAID`/`BAD_DEBT` men
  inte för `DRAFT→SENT`/`CANCELLED`/`INSTALLMENT_PLAN` som inte följer av
  ledgern. Maskin + ledger kompletterar varandra.
- **Status enbart som dispatch-derivat.** För stort grepp nu; #178 är additivt.
