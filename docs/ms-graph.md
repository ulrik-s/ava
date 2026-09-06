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

## E2E-flödet

Två steg i `ms-graph-e2e.yml`, i den ordningen med flit:

| Steg | Bevisar | Varför före/efter |
|---|---|---|
| `ms:smoke` | att token-kedjan håller | fäller på 10 sekunder om auth är trasig — då byggs ingen container i onödan |
| mail-E2E | att integrationen fungerar | behöver en körande AVA-stack |

Mail-E2E:t går hela vägen:

```
sendMail → polla tills mailet landat → fetchMessageEml ($value, rå MIME)
         → mail.saveIncoming mot en riktig AVA-stack
         → läs tillbaka och jämför BYTE FÖR BYTE
```

Sista steget är poängen. Att Graph svarade 200 säger inget om att rätt bytes
hamnade i rätt ärende — `document.downloadContent` jämförs mot exakt de bytes
`$value` gav.

Flödet använder de RIKTIGA funktionerna ur `src/lib/client/graph/graph-mail.ts`,
inte egna kopior. Ett e2e som återimplementerar det det ska bevisa bevisar
ingenting — och `graph-mail.ts` är just den fil vars enhetstester kör mot
injicerad `fetch` och därför är blinda för att Microsoft ändrat sig.

Tre detaljer som är lätta att få fel:

- **Eventuell konsistens.** Ett skickat mail syns inte omedelbart. Testet pollar
  med tak (30 × 3 s) och ett felmeddelande som pekar på `AVA_MS_TEST_MAILBOX` —
  inte en fast `sleep`, som blir flakig.
- **Unikt ämne per körning.** Annars kan testet plocka upp ett mail från en
  tidigare körning och bli grönt på fel bevis.
- **`receivedAt` kommer från MAILET**, inte väggklockan, så körningen beter sig
  likadant oavsett när på dygnet den startar.

### Delta-kollen

Att läsa tillbaka mailet man själv skickade svarar på *"landade det vi skickade
rätt?"*. Den frågan kan strukturellt inte se att det landade något **mer** — en
dubblett från en omkörning, ett halvskrivet mail från ett avbrutet jobb.

Därför listas inkorgen före och efter, och skillnaden måste vara **exakt** det
meddelande testet skapade. Två billiga listningar, inget som behöver nollställas.

Tre detaljer som är avgörande för att kollen inte ska bli tyst:

- **Inkorgen, inte `/me/messages`.** `sendMail` sparar en kopia i Skickat, så
  delta mot hela brevlådan hade gett två nya meddelanden varav vi bara känner
  id:t på ett — och då är frestelsen att härleda det förväntade ur utfallet,
  vilket gör kollen meningslös.
- **`$top=2`.** Graph sidnumrerar med `@odata.nextLink`. Med normal sidstorlek
  hade brevlådan behövt hundratals mail innan loopen kördes första gången —
  månader av grönt utan att pagineringskoden någonsin testats. Två per sida
  betyder att `nextLink` följs vid varje körning.
- **`nextLink` följs ordagrant.** Den bär en skip-token; byggs URL:en om börjar
  listningen om från sida ett, vilket ser ut som en hängning snarare än ett fel.

Kollen tål ackumulerad historik: gamla testmail ligger i både före- och
efter-mängden och tar ut sig själva.

### Städningen: testmailen ligger kvar, med flit

Graph **kan** radera — till skillnad från Fortnox verifikat, vars avsaknad av
`DELETE` tvingade fram hela resonemanget om städbara serier och räkenskapsår.
Men `DELETE /me/messages/{id}` kräver `Mail.ReadWrite`, och det är enligt
Microsofts egen tabell den LÄGSTA behörighet som duger (verifierat 2026-09-06;
första skarpa körningen svarade 403).

AVA läser och skickar mail. Att be varje jurist om **skrivrätt** till sin egen
brevlåda — för att ett testflöde ska kunna städa efter sig — är precis den
sortens över-fråga ADR 0036 argumenterar emot. Consent-dialogen ska gå att läsa
och säga ja till.

Ett testmail per nattlig körning ackumuleras därför i testbrevlådan. Vad vi gör
åt det hör hemma i #1075.

Lokalt (startar stacken själv):

```bash
AVA_MS_CLIENT_ID=… AVA_MS_CLIENT_SECRET=… AVA_MS_TENANT_ID=… \
AVA_MS_REFRESH_TOKEN=… AVA_MS_TEST_MAILBOX=… bun run ms:mail
```

Refresh-token:en roterar i första anropet — din lokala kopia är förbrukad efter
körningen. Hämta en ny med `bun run ms:connect --listen`.

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

## Testtenanten

| | |
|---|---|
| Tenant | `QnyxAB.onmicrosoft.com` (Qnyx AB) |
| Testbrevlåda | `UlrikSjolin@QnyxAB.onmicrosoft.com`, Microsoft 365 Business Basic |
| App | AVA (dev), single tenant, redirect `http://localhost:53682/callback` |

Verifierat mot skarp Graph 2026-09-06, hela vägen:

```
refresh (roterade) → GET /me → sendMail 202 → hittad i inkorgen efter 3 s
                   → GET /messages/{id}/$value → 200, 693 bytes rå MIME
```

Att `$value` faktiskt ger MIME och inte JSON är värt att ha bevisat: det är den
byte-strömmen `mail.saveIncoming` ska skriva som `.eml`, och ett enhetstest mot
injicerad `fetch` hade sagt ja oavsett vad Microsoft returnerade.

### Varför inte den första tenanten

Det första försöket gjordes i en tenant som Entra skapade automatiskt vid
inloggning med ett gmail-konto. Den vägen är en återvändsgränd, och det är värt
att veta innan någon provar igen:

- `admin.microsoft.com` skickar `msafed=0` och **släpper inte in personliga
  Microsoft-konton alls** — "You can't sign in here with a personal account"
- ett gästkonto (`…#EXT#@…`) kan administrera Entra men aldrig äga en brevlåda
- faktureringsprofilen gick inte att skapa: organisationsprofilen som en
  köpflödet bygger på saknas i en tenant som uppstått som biprodukt

Microsoft 365 Developer Programs kostnadsfria E5-sandbox är inte heller en väg
ut: den kräver Visual Studio **Professional eller Enterprise**. Dev Essentials
(gratis) kvalificerar inte — dashboarden svarar "You don't currently qualify"
(verifierat 2026-09-06).

Lösningen var att starta Business Basic-prövotiden från microsoft.com i stället
för inifrån admin center. Det flödet **skapar en egen tenant** med riktig
organisationsprofil, fungerande fakturering och en licensierad brevlåda direkt.
