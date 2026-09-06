# Microsoft Graph — anslutning och tokens

Motsvarigheten till [`fortnox-e2e.md`](fortnox-e2e.md) för Graph-epicen (#1069).
Den här sidan täcker **anslutningen** (#1071, #1072); e2e-flödet och CI-jobbet
växer in här när #1073–#1075 landat.

## Behörighetsmodellen: delegerad

AVA använder **delegerade** behörigheter, inte applikationsbehörigheter. En
app-only-token med `Mail.Read` ger läsrätt till **varje** brevlåda i tenanten,
inklusive korrespondens i ärenden juristen inte arbetar med. För en advokatbyrå
är det en sekretessfråga, inte en teknikdetalj — jfr byråjävet i VRGA 3.5, där
det har betydelse att information *finns tillgänglig*.

Priset är att consent kräver en människa en gång, och att refresh-token dör av
inaktivitet. Fortnox visade att det priset går att betala i obevakad CI, så länge
den roterade token:en skrivs tillbaka vid varje körning.

Scopes (`MS_DEFAULT_SCOPES` i `src/lib/server/integrations/msgraph/schema.ts`):

| Scope | Varför |
|---|---|
| `offline_access` | **utan den skickar Entra ingen refresh-token alls** |
| `Mail.Read` | läsa mail → `mail.saveIncoming` |
| `Mail.Send` | skicka från ärendet |
| `User.Read` | identifiera den inloggade |

## Ansluta

```bash
AVA_MS_CLIENT_ID=…  AVA_MS_CLIENT_SECRET=…  AVA_MS_TENANT_ID=… \
AVA_MS_REDIRECT_URI=http://localhost:53682/callback \
  bun run ms:connect --listen
```

`--listen` skriver ut authorize-URL:en, tar emot redirecten själv, jämför `state`
och växlar in koden direkt. Koden lever ~60 sekunder — den marginalen räcker inte
om något kommer emellan, vilket är hela skälet till flaggan.

Pekar redirect-URI:n någon annanstans finns tvåstegsvarianten: kör utan flagga
för att få URL:en, godkänn, och kör `--code <kod>` med koden ur adressfältet.

Ut kommer en refresh-token. Den ska in som secret, inte i en fil.

## Hur `redirect_uri` jämförs — tvärtom mot Fortnox

Fortnox jämför parametern **före** URL-decode, vilket tvingade fram en rå,
oencodad sträng (#1038). Microsoft kräver motsatsen: "It must exactly match one
of the redirect URIs you registered … except it must be URL-encoded."

Verifierat mot skarp authorize-endpoint 2026-09-06: percent-encodad → consent
går igenom. Regressionstestet asserterar på **råsträngen** i URL:en, eftersom
`url.searchParams.get(…)` decodar och skulle visa samma svar åt båda hållen —
precis den blindhet som lät Fortnox-buggen ligga kvar.

## Miljön `ms-graph` i CI

| Secret | Innehåll |
|---|---|
| `AVA_MS_CLIENT_ID` | Application (client) ID |
| `AVA_MS_CLIENT_SECRET` | klient-hemlighet ur Certificates & secrets |
| `AVA_MS_TENANT_ID` | tenant-GUID |
| `AVA_MS_REFRESH_TOKEN` | roterande — skrivs tillbaka av varje körning (#1073) |
| `AVA_MS_ROTATE_PAT` | PAT som får skriva environment-secrets |

| Variabel | Innehåll |
|---|---|
| `AVA_MS_TENANT_DOMAIN` | `*.onmicrosoft.com`, bara för felsökning |
| `AVA_MS_CI_ENABLED` | avstängningsknapp — **repo**-variabel, inte environment |

Fällorna från Fortnox gäller ordagrant här (se #1071): `gh secret set --body -`
sparar strängen `-`; ett job-`if` på en *environment*-variabel utvärderas innan
`environment:` resolvas och blir alltid tomt; PAT:en behöver behörigheten
**Environments**, inte `Secrets`.

## Vad som INTE går än: brevlådan

Tenanten `ulriksjolingmail.onmicrosoft.com` har **noll M365-licenser**, alltså
ingen Exchange-brevlåda. `GET /me` svarar 200 med `"mail": null`, och allt i
`Mail.*` kommer att svara `MailboxNotEnabledForRESTAPI`.

Microsoft 365 Developer Program ger inte längre en gratis E5-sandbox till alla —
dashboarden svarar "You don't currently qualify" utan en Visual
Studio-prenumeration (verifierat 2026-09-06). Det som återstår är en betald
licens med Exchange Online i tenanten; en M365 Business Basic-prövotid räcker för
att komma igång.

Fram till dess är #1074 och #1075 blockerade. Anslutningen, rotationen och
`ms:connect` är däremot verifierade mot skarp Entra och påverkas inte.
