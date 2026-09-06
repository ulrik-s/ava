# ADR 0036 — Behörighetsmodell för Microsoft Graph: delegerad

**Status:** Antagen · **Datum:** 2026-09-06 · **Issue:** #1070, #1069

## Kontext

Graph-epicen (#1069) ska ta Outlook- och Word-integrationerna lika långt som
Fortnox: obevakad CI mot skarpt API, med bevisad rotation av tokens. Första
frågan är vilken behörighetsmodell allt annat ska byggas ovanpå.

Fortnox löstes med ett **servicekonto** — en egen identitet utan koppling till en
anställd, som överlever att någon slutar. Graph har ingen ren motsvarighet för
brevlådor. Det finns två modeller, och de skiljer sig i något annat än teknik:

| Modell | Vad den ger | Priset |
|---|---|---|
| **Delegerad** (`Mail.Read` + `offline_access`) | AVA ser bara den inloggade juristens brevlåda | consent kräver en människa en gång; refresh-token dör av inaktivitet |
| **Applikationsbehörighet** (app-only) | obevakad drift, inga användarklick | läsrätt till **alla** brevlådor i tenanten |

## Beslut

**Delegerade behörigheter.** Samma modell i CI som i drift, precis som Fortnox
körde servicekonto på båda.

Minsta scope-uppsättningen (`MS_DEFAULT_SCOPES`,
`src/lib/server/integrations/msgraph/schema.ts`):

| Scope | Funktion |
|---|---|
| `offline_access` | refresh-token — utan den skickar Entra ingen alls |
| `Mail.Read` | läsa mail → `mail.saveIncoming` |
| `Mail.Send` | skicka från ärendet |
| `User.Read` | identifiera den inloggade |

## Skäl

**Det här är en sekretessfråga, inte en teknikdetalj.** App-only `Mail.Read` ger
AVA läsrätt till varje anställds brevlåda i tenanten — inklusive korrespondens i
ärenden juristen inte arbetar med. Jämför byråjävet i VRGA 3.5: där har det
betydelse redan att information *finns tillgänglig*, inte bara att någon läst
den. En byrå som installerar AVA ska inte behöva ge den den räckvidden för att
få en mail-koppling till ett ärende.

**Priset visade sig vara betalbart.** Invändningen mot delegerat är att det
kräver en människa och att token:en dör. Fortnox har redan visat att det går att
köra obevakat ändå, förutsatt att den roterade token:en skrivs tillbaka vid varje
körning. Det mönstret är byggt och verifierat mot skarp Entra (#1072): authorize
→ code → tokens → refresh (roterade) → `GET /me` svarade 200.

**Application Access Policy behövs inte.** Mellanvägen som utreddes i #1070 —
`New-ApplicationAccessPolicy` för att begränsa app-only-åtkomst till en grupp
brevlådor — är bara relevant om vi går app-only. Den frågan faller med beslutet.

## Vad byrån godkänner vid installation

Vid första inloggningen visar Entra en consent-dialog. Den ska kunna läsas och
förstås av den som klickar, så scope-listan hålls kort med flit. En byrå-admin
kan ge consent för hela organisationen; utan det får varje jurist samma dialog en
gång. Båda vägarna ger AVA åtkomst till **den inloggades** brevlåda och inget
annat.

## Testtenant

Ursprungsplanen i #1070 var Microsoft 365 Developer Programs kostnadsfria
E5-sandbox med 16 fiktiva användare och färdig mail-data. **Den finns inte att få
längre** — den kräver Visual Studio Professional eller Enterprise, och Dev
Essentials (gratis) kvalificerar inte (verifierat 2026-09-06).

Det som används i stället är en egen tenant med **betald Exchange-licens**:
`QnyxAB.onmicrosoft.com`, Microsoft 365 Business Basic, en licensierad
testbrevlåda. Kedjan är verifierad mot skarp Graph — skickat mail, hittat i
inkorgen, rå MIME hämtad via `$value`. Se [`docs/ms-graph.md`](../ms-graph.md).

Kravet att **inte** använda en produktions-tenant står kvar och blir viktigare
med delegerat consent: en admin-consent i arbetsgivarens tenant gäller riktiga
brevlådor.

## Konsekvenser

- CI behöver en `AVA_MS_REFRESH_TOKEN` som skrivs tillbaka vid varje körning
  (#1073). Faller write-backen är anslutningen död efter en körning — samma
  failure-mode som Fortnox, och samma motmedel: emitta token:en direkt efter
  första refreshen, write-back-steget med `if: always()`, `::add-mask::` före
  `$GITHUB_OUTPUT`.
- Refresh-token dör av inaktivitet. En nattlig körning håller den vid liv; en
  längre paus kräver en ny consent-runda med `bun run ms:connect --listen`.
- Add-ins (#1076, #1077) autentiserar som den inloggade användaren, inte som en
  tjänst. Det är samma modell som web-appens OIDC-inloggning (ADR 0009).
- Mail-e2e:n (#1074) kan städa efter sig — Graph har `DELETE` för meddelanden,
  till skillnad från Fortnox verifikat. Hela resonemanget om städbara serier och
  räkenskapsår har ingen motsvarighet här.
