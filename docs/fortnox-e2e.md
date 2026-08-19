# Fortnox-E2E — köra mot riktiga Voucher API

Enhetstesterna för connectorn kör med injicerad `fetch` och bevisar att VÅR kod
är konsekvent. De kan inte upptäcka att Fortnox ändrat sig. Det här flödet går
hela vägen: OAuth-refresh → semantiskt verifikat → `POST /3/vouchers` → läs
tillbaka verifikatet → kontrollera balans och idempotens.

Kör: **Actions → “Fortnox E2E (manuell)” → Run workflow**.
Lokalt: `bun tooling/scripts/fortnox-e2e.ts` med env satt (se nedan).

## Varför den inte ligger i PR-matrisen

Varje körning skapar ett verifikat som **inte går att ta tillbaka**. En grind
som bränner verifikatnummer på varje PR vore fel sorts grind. Kör den när
connectorn ändras, före release, eller för att bekräfta att anslutningen lever.

`dry_run`-inputen kör allt utom själva pushen — bra för att bara verifiera att
tokens fortfarande fungerar.

## Secrets och variabler

Ligger på environment **`fortnox-sandbox`** (Settings → Environments), inte som
repo-secrets — så åtkomsten kan begränsas separat.

| Secret | Vad |
|---|---|
| `AVA_FORTNOX_CLIENT_ID` | ur Developer Portal |
| `AVA_FORTNOX_CLIENT_SECRET` | ur Developer Portal |
| `AVA_FORTNOX_REFRESH_TOKEN` | från consent-rundan — **roterar vid varje körning**, se nedan |
| `AVA_FORTNOX_ROTATE_PAT` | PAT med `secrets: write` på repot, så jobbet kan spara den roterade token:en |

| Variable (`vars`) | Default | Vad |
|---|---|---|
| `AVA_FORTNOX_VOUCHER_SERIES` | `A` | verifikatserie |
| `AVA_FORTNOX_KONTO_KUNDFORDRAN` | `1510` | kundfordran (debet) |
| `AVA_FORTNOX_KONTO_ARVODE` | `3041` | arvodesintäkt (kredit) |
| `AVA_FORTNOX_KONTO_MOMS` | `2611` | utgående moms 25 % (kredit) |

Kontona är ett **bokföringsbeslut per byrå** — defaults är BAS-standard och
ingen rekommendation.

## Det roterande refresh-token:et

Fortnox ogiltigförklarar den gamla refresh-token:en vid varje refresh
(access-token 1 h, refresh-token 45 dygn). Konsekvensen är kontraintuitiv:

> Ett refresh-token i en secret räcker till **exakt en körning** om inte det nya
> skrivs tillbaka.

Därför emitterar scriptet den roterade token:en till `GITHUB_OUTPUT` **direkt
efter första anropet**, före allt som kan fela, och workflow:et sparar den med
`if: always()`. Token:en skrivs aldrig till stdout.

Saknas `AVA_FORTNOX_ROTATE_PAT` fäller jobbet med ett tydligt fel — hellre det
än en tyst död token som visar sig först vid nästa körning.

## När token:en dött ändå

Refresh-token:en dör efter 45 dygn utan användning, och en misslyckad
write-back får samma effekt. Då krävs en ny consent-runda — den kan inte
automatiseras, eftersom den kräver en människa som godkänner i Fortnox:

Kör **lokalt** (aldrig i CI — `client_secret` ska inte lämna din maskin, och
`code` är engångs och kortlivad):

```bash
# 1. Bygg authorize-URL:en. Ingen hemlighet behövs i det här steget.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_REDIRECT_URI=… bun run fortnox:connect

# 2. Godkänn i browsern. Kontrollera att `state` kommer tillbaka oförändrat
#    (CSRF). Kopiera ?code=… ur adressfältet — landar du på en död sida är det
#    väntat, koden står ändå i URL:en.

# 3. Växla in koden → skriver ut refresh-token att lägga som secret.
AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_CLIENT_SECRET=… AVA_FORTNOX_REDIRECT_URI=… \
  bun run fortnox:connect --code <kod>
```

`redirect_uri` måste matcha registreringen i Developer Portal **tecken för
tecken** — annars avvisas anropet redan i steg 1.

Modellen är **user-consent** (ingen `account_type`) — det är det flöde som
verifierats mot sandbox. Service-konto är opt-in, se connector-README:n och
[#213](https://github.com/ulrik-s/ava/issues/213).

## Kända begränsningar

- **Går inte att köra från Claude Code-containern.** `bun`:s `fetch` når inte
  igenom containerns proxy till Fortnox (`socket connection was closed
  unexpectedly`) medan `curl` gör det. GitHub-runnern har ingen sådan proxy.
- **Testfakturan är syntetisk** (125,00 kr inkl moms, `E2E-<tidsstämpel>`) och
  byggs i minnet. Det som testas är ledger-vägen, inte repo-lagret — det har
  egna tester.
- **Bilagor (#785) täcks inte** av e2e:t ännu; `uploadInboxFile` +
  `connectFileToVoucher` är enhetstestade men inte körda skarpt.
