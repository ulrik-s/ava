# SEB camt.053/054 — exempelfiler (testfixturer)

ISO 20022 cash management-rapportering (kontoutdrag + inbetalnings-aviseringar)
för **betalnings-avprickningen** (#164, #173, #175). Fixturerna driver
parsern/matchningsmotorn när den byggs.

## Källa

Hämtade från **SEB Test Bench** — paketet *"SEB MIG for Reporting
camt.052/camt.053/camt.054 V2"* (`SEB_MIG_ISO20022XML_Camt_B2C.zip`,
katalogen `SEB_camt.052_053_054_Samples/`). Detta är SEB:s **publika
exempel-/testfiler** för affärssystem som ska läsa in återrapportering, inte
verkliga kunddata (`TEST Customer`, `Debtor` etc.).
<https://sebgroup.com/our-offering/cash-management/integration-services/test-bench>

Endast den **svenska** delmängden som rör inkommande kundbetalningar är
medtagen (resten av paketet är internationella varianter, debet/utbetalning,
cash pool, autogiro, Swish m.m. — ej relevanta för avprickningen ännu).

## Filer

| Fil | Typ | Referens-väg | Täcker |
|-----|-----|--------------|--------|
| `camt.054_SE_CRED_BGC.xml` | camt.054 (avisering) | **strukturerad** `RmtInf/Strd` (`CINV`) | Bankgiro-inbetalningar med faktura-/OCR-referens → **OCR-matchning (#164)** |
| `camt.054_SE.xml` | camt.054 (avisering) | **ostrukturerad** `RmtInf/Ustrd` | Betalning utan OCR, fri-text-referens → **fri-text-matchning (#175)** (t.ex. domstols-/målnummer) |
| `camt.053_SE.xml` | camt.053 (kontoutdrag) | bägge | Svenskt end-of-day-kontoutdrag (alternativ avprickningskälla) |
| `camt.053_SE_BGC_Credit.xml` | camt.053 (kontoutdrag) | strukturerad | Kontoutdrag med Bankgiro-krediteringar |
| `camt.053.001.02.xsd` | XSD | — | Schema för camt.053-validering |
| `camt.054.001.02.xsd` | XSD | — | Schema för camt.054-validering |

## Påminnelse om mappning (jfr #175)

- **OCR** ligger i `RmtInf/Strd/CdtrRefInf/Ref` (strukturerad creditor-referens).
- **Fri-text-referens** (målnummer / AVA-ärendereferens, betalningar utan OCR)
  ligger i `RmtInf/Ustrd` — och ibland i `EndToEndId`.
- **Betalaren** identifieras via `RltdPties/Dbtr/Nm` + konto.

Integritets-/laddningstest: `test/unit/lib/payments/camt-fixtures.test.ts`.
